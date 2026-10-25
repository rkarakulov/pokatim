import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEVICE_PROVIDERS, type DeviceProvider } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV } from '@rkarakulov/api-kit/core';
import { MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';
import { UnrecoverableError } from 'bullmq';

import type { Env } from '../../config/env';
import { TRACK_INGEST, type TrackIngest, TrackStorageFullError } from '../tracks';
import { DeviceAudit } from './device-audit';
import { DevicesLocks, DevicesPullQueue, pullLockKey } from './devices-jobs';
import type { DeviceConnectionDoc, DeviceImportDoc } from './devices.collection';
import type { DevicesRevokeRequested } from './devices.events';
import { DEVICES_POLICY, importDecision, pullWindow } from './devices.policy';
import { DevicesRepository } from './devices.repository';
import {
  AggregatorError,
  type AggregatorWorkout,
  TrackTooLongError,
  WEARABLES_AGGREGATOR,
  type WearablesAggregator,
} from './wearables-aggregator';

export type PullOutcome = 'done' | 'partial' | 'busy' | 'inactive';

/** Попытка задачи: последняя — финальный провал виден пользователю (`issue`), а не только в очереди. */
export interface Attempt {
  final: boolean;
}

/** Повторяемый сбой pull (агрегатор, хранилище): задача BullMQ повторится с экспонентой. */
export class PullRetryError extends Error {
  constructor(reason: string) {
    super(`pull will be retried: ${reason}`);
    this.name = 'PullRetryError';
  }
}

const isProvider = (value: string): value is DeviceProvider =>
  (DEVICE_PROVIDERS as readonly string[]).includes(value);

/**
 * Синхронизация (worker, §7 «Pull и импорт»): тренировки активного подключения за окно → велотипы этого провайдера
 * → новые (`device_imports` уникален `(provider, aggWorkoutId)`) → трек `/timeseries` без децимации →
 * `TrackIngest.ingestProviderStream` (тот же разбор, что у ручной загрузки). Импорт с созданной загрузкой не
 * повторяется (удалённая не воскресает); провал — до 5 попыток, затем `issue: 'sync_failed'`. Логи — id подключения
 * и импорта, без координат, пульса, мощности и id агрегатора.
 */
@Injectable()
export class DevicesSyncService {
  private readonly logger = new Logger(DevicesSyncService.name);

  constructor(
    private readonly repository: DevicesRepository,
    private readonly audit: DeviceAudit,
    private readonly transactions: MongoTransactions,
    private readonly locks: DevicesLocks,
    private readonly pulls: DevicesPullQueue,
    @Inject(TRACK_INGEST) private readonly ingest: TrackIngest,
    @Inject(WEARABLES_AGGREGATOR) private readonly aggregator: WearablesAggregator,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async pull(connectionId: string, attempt: Attempt = { final: false }): Promise<PullOutcome> {
    const key = pullLockKey(connectionId);
    const token = await this.locks.tryAcquire(key, DEVICES_POLICY.pullLockTtlMs);
    if (!token) return 'busy';
    try {
      const connection = await this.repository.findConnection(connectionId);
      if (connection?.status !== 'active') return 'inactive';
      return await this.pullConnection(connection, attempt);
    } finally {
      await this.locks.release(key, token);
    }
  }

  private async pullConnection(
    connection: DeviceConnectionDoc,
    attempt: Attempt,
  ): Promise<PullOutcome> {
    const now = this.clock.now();
    const window = pullWindow(connection, now, this.env.DEVICES_HISTORY_DAYS);
    let failures = 0;
    let retry: string | null = null;
    try {
      for await (const workout of this.aggregator.listWorkouts(connection.aggUserId, window)) {
        const result = await this.importWorkout(connection, workout);
        if (result === 'failed') failures += 1;
        if (result === 'storage') {
          failures += 1;
          retry = 'storage';
          break;
        }
        if (result === 'retry') {
          failures += 1;
          retry = 'aggregator';
        }
      }
    } catch (error) {
      await this.pullFailed(connection, error, attempt);
      throw error instanceof AggregatorError && !error.retryable
        ? new UnrecoverableError(`pull failed: ${error.kind}`)
        : error;
    }

    if (failures === 0) {
      await this.repository.markSynced(connection._id, now);
      const exhausted = await this.repository.countExhaustedImports(
        connection.userId,
        connection.provider,
        DEVICES_POLICY.maxImportAttempts,
      );
      if (exhausted === 0) await this.repository.clearIssue(connection._id, 'sync_failed');
    }
    this.logger.log(`devices.pull connection=${connection._id} failures=${failures}`);
    if (retry) {
      if (attempt.final) await this.setSyncFailed(connection);
      throw new PullRetryError(retry);
    }
    return failures === 0 ? 'done' : 'partial';
  }

  private async pullFailed(
    connection: DeviceConnectionDoc,
    error: unknown,
    attempt: Attempt,
  ): Promise<void> {
    const kind = error instanceof AggregatorError ? error.kind : 'error';
    this.logger.warn(`devices.pull_failed connection=${connection._id} reason=${kind}`);
    const retryable = error instanceof AggregatorError ? error.retryable : true;
    if (attempt.final || !retryable) await this.setSyncFailed(connection);
  }

  private async setSyncFailed(connection: DeviceConnectionDoc): Promise<void> {
    if (await this.repository.setIssue(undefined, connection._id, 'sync_failed')) {
      this.logger.warn(`devices.sync_failed connection=${connection._id}`);
    }
  }

  /**
   * Одна тренировка: решение политики → захват импорта (новый или повтор `failed` без загрузки) → трек → поток в
   * `tracks`. `retry` — повторяемый сбой агрегатора (pull повторится), `storage` — хранилище заполнено (отложить).
   */
  private async importWorkout(
    connection: DeviceConnectionDoc,
    workout: AggregatorWorkout,
  ): Promise<'skipped' | 'imported' | 'failed' | 'retry' | 'storage' | 'ignored'> {
    const decision = importDecision(workout, connection.provider);
    if (decision.kind === 'ignore') return 'ignored';
    const claimed = await this.claim(connection, workout.id);
    if (!claimed) return 'ignored';
    const now = () => this.clock.now();

    if (decision.kind === 'skip') {
      await this.repository.finishImport(claimed._id, {
        status: 'skipped',
        reason: decision.reason,
        uploadId: null,
        now: now(),
      });
      return 'skipped';
    }

    try {
      const points = await this.aggregator.fetchWorkoutTrack(
        connection.aggUserId,
        connection.provider,
        { from: workout.startedAt, to: decision.end },
        DEVICES_POLICY.maxTrackPoints,
      );
      if (points.length === 0) {
        await this.repository.finishImport(claimed._id, {
          status: 'skipped',
          reason: 'no_track',
          uploadId: null,
          now: now(),
        });
        return 'skipped';
      }
      const { uploadId } = await this.ingest.ingestProviderStream({
        userId: connection.userId,
        source: connection.provider,
        via: 'open_wearables',
        sourceRef: workout.id,
        stream: {
          v: 1,
          provider: connection.provider,
          sport: workout.type,
          hasHeartRate: workout.hasHeartRate,
          hasPower: workout.hasPower,
          points,
        },
      });
      await this.repository.finishImport(claimed._id, {
        status: 'imported',
        reason: null,
        uploadId,
        now: now(),
      });
      this.logger.log(`devices.imported import=${claimed._id} upload=${uploadId}`);
      return 'imported';
    } catch (error) {
      if (error instanceof TrackTooLongError) {
        await this.repository.finishImport(claimed._id, {
          status: 'skipped',
          reason: 'too_many_points',
          uploadId: null,
          now: now(),
        });
        return 'skipped';
      }
      const reason =
        error instanceof TrackStorageFullError
          ? 'storage'
          : error instanceof AggregatorError
            ? `aggregator_${error.kind}`
            : 'error';
      await this.repository.finishImport(claimed._id, {
        status: 'failed',
        reason,
        uploadId: null,
        now: now(),
      });
      this.logger.warn(
        `devices.import_failed import=${claimed._id} reason=${reason} attempt=${claimed.attempts}`,
      );
      if (claimed.attempts >= DEVICES_POLICY.maxImportAttempts)
        await this.setSyncFailed(connection);
      if (error instanceof AggregatorError && error.kind === 'auth') throw error;
      if (error instanceof TrackStorageFullError) return 'storage';
      return error instanceof AggregatorError && error.retryable ? 'retry' : 'failed';
    }
  }

  /** Новый импорт (`queued`, попытка 1) или повтор незавершённого без загрузки; остальное — уже решено. */
  private async claim(
    connection: DeviceConnectionDoc,
    aggWorkoutId: string,
  ): Promise<DeviceImportDoc | undefined> {
    const now = this.clock.now();
    const existing = await this.repository.findImport(connection.provider, aggWorkoutId);
    if (!existing) {
      const doc: DeviceImportDoc = {
        _id: uuidv7(),
        userId: connection.userId,
        provider: connection.provider,
        aggWorkoutId,
        status: 'queued',
        reason: null,
        attempts: 1,
        uploadId: null,
        firstSeenAt: now,
        updatedAt: now,
      };
      if (await this.repository.insertImport(doc)) return doc;
      return undefined;
    }
    // тренировка другого пользователя pokatim (тот же аккаунт провайдера) — не наша
    if (existing.userId !== connection.userId) return undefined;
    return this.repository.claimRetry(existing._id, DEVICES_POLICY.maxImportAttempts, now);
  }

  /** `devices.connected`: историческая выгрузка (ошибка — лог и продолжение) + первый pull. */
  async onConnected(connectionId: string): Promise<'scheduled' | 'inactive'> {
    const connection = await this.repository.findConnection(connectionId);
    if (connection?.status !== 'active') return 'inactive';
    try {
      const started = await this.aggregator.requestHistoricalSync(
        connection.aggUserId,
        connection.provider,
        this.env.DEVICES_HISTORY_DAYS,
      );
      this.logger.log(`devices.historical connection=${connectionId} started=${started}`);
    } catch (error) {
      const kind = error instanceof AggregatorError ? error.kind : 'error';
      this.logger.warn(`devices.historical_failed connection=${connectionId} reason=${kind}`);
    }
    await this.pulls.schedule(connectionId, 'connected');
    return 'scheduled';
  }

  /**
   * `devices.revoke-requested`: `revokeConnection` в агрегаторе → (галочка) удаление загрузок провайдера → `revoked`.
   * Повторяемый сбой — ретрай BullMQ; финальный или неповторяемый — `revoked` + `revokeFailed` и журнал.
   */
  async revoke(
    event: DevicesRevokeRequested,
    attempt: Attempt,
  ): Promise<'revoked' | 'revoke_failed' | 'skipped'> {
    const connection = await this.repository.findConnection(event.connectionId);
    if (connection?.status !== 'disconnecting') return 'skipped';
    let failed = false;
    try {
      await this.aggregator.revokeConnection(connection.aggUserId, connection.provider);
    } catch (error) {
      const retryable = !(error instanceof AggregatorError) || error.retryable;
      if (retryable && !attempt.final) throw error;
      failed = true;
      const kind = error instanceof AggregatorError ? error.kind : 'error';
      this.logger.warn(`devices.revoke_failed connection=${connection._id} reason=${kind}`);
    }
    if (event.deleteActivities) {
      const removed = await this.ingest.deleteSourceUploads(connection.userId, connection.provider);
      this.logger.log(`devices.uploads_deleted connection=${connection._id} count=${removed}`);
    }
    const now = this.clock.now();
    await this.transactions.run(async (session) => {
      const updated = await this.repository.markRevoked(session, connection._id, 'disconnecting', {
        reason: event.reason,
        revokeFailed: failed,
        now,
      });
      if (updated && failed) {
        await this.audit.append(session, {
          userId: connection.userId,
          provider: connection.provider,
          connectionId: connection._id,
          action: 'revoke_failed',
          reason: event.reason,
        });
      }
    });
    this.logger.log(`devices.revoked connection=${connection._id} failed=${failed}`);
    return failed ? 'revoke_failed' : 'revoked';
  }

  /** `tracks.upload-deleted` загрузки провайдера: надгробие импорта — следующий pull её не вернёт. */
  async onUploadDeleted(source: string, sourceRef: string): Promise<'tombstoned' | 'skipped'> {
    if (!isProvider(source)) return 'skipped';
    const changed = await this.repository.tombstone(source, sourceRef, this.clock.now());
    return changed ? 'tombstoned' : 'skipped';
  }
}
