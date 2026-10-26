import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type RateLimitedDetails,
  type TrackSource,
  type TrackUpload,
  type TrackUploadPage,
  TrackUploadName,
} from '@pokatim/contracts';
import { detectTrackFormat } from '@pokatim/tracks';
import { CLOCK, type Clock, ENV, RateLimiter, type RateLimitRule } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, MongoTransactions } from '@rkarakulov/api-kit/mongo';
import { z } from 'zod';

import type { Env } from '../../config/env';
import { domainError } from '../../error-messages';
import { decodeCursor, encodeCursor } from '../../page-cursor';
import { rateLimitKeyForIp } from '../identity';
import { regroupAfterDelete } from './activity-groups';
import { TRACK_FILE_STORE, type TrackFileStore } from './track-file-store';
import { TrackStorageFullError } from './track-ingest.port';
import { TrackSourcesService } from './track-sources.service';
import type { ActivityDoc, TrackUploadDoc } from './tracks.collection';
import { TRACK_ACTIVITY_REMOVED, TRACK_UPLOAD_DELETED } from './tracks.events';
import { TRACKS_POLICY } from './tracks.policy';
import { sourceRefKey, TracksRepository } from './tracks.repository';

/** Курсор списка загрузок: ключ — константа (сортировка только по `_id`). */
const TrackUploadCursorKey = z.literal('u');

/** Ответ приложения: без `sha256`, `storageKey`, `sourceRef`, координат и биометрии (§8.3 п. 3). */
export function toTrackUpload(
  upload: TrackUploadDoc,
  activity: ActivityDoc | undefined,
): TrackUpload {
  return {
    id: upload._id,
    source: upload.source,
    format: upload.format,
    fileName: upload.fileName,
    status: upload.status,
    failure: upload.failure,
    createdAt: upload.createdAt.toISOString(),
    activity: activity
      ? {
          id: activity._id,
          sport: activity.sport,
          startedAt: activity.startedAt.toISOString(),
          elapsedSec: activity.elapsedSec,
          distanceM: activity.distanceM,
        }
      : null,
  };
}

/**
 * Ручная загрузка заездов и свои загрузки (под `AuthGuard`): лимиты, семафор приёмов, формат по содержимому (R2),
 * приём исходника — `TrackSourcesService`; удаление — каскад под `lockUserActivities` и затем файл.
 */
@Injectable()
export class TrackUploadsService {
  private readonly logger = new Logger(TrackUploadsService.name);
  private inFlight = 0;

  constructor(
    private readonly repository: TracksRepository,
    private readonly sources: TrackSourcesService,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    private readonly rateLimiter: RateLimiter,
    @Inject(TRACK_FILE_STORE) private readonly files: TrackFileStore,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Имя файла из `?name=` — только для показа; невалидное — `400`. */
  parseName(raw: unknown): string | null {
    if (raw === undefined || raw === '') return null;
    const parsed = TrackUploadName.safeParse(raw);
    if (!parsed.success) {
      throw domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'name', code: 'INVALID' }] });
    }
    return parsed.data;
  }

  /** Лимиты пользователя и IP (до чтения тела) и семафор приёмов; `release` — после ответа. */
  async admit(userId: string, ip: string): Promise<{ release: () => void }> {
    const now = this.clock.now();
    await this.consume(`tracks-upload-user:${userId}`, TRACKS_POLICY.uploadUserLimit, now);
    await this.consume(
      `tracks-upload-ip:${rateLimitKeyForIp(this.env.EMAIL_TOKEN_SECRET, ip)}`,
      TRACKS_POLICY.uploadIpLimit,
      now,
    );
    if (this.inFlight >= TRACKS_POLICY.maxConcurrentUploads) {
      const details: RateLimitedDetails = { retryAfterSec: 5 };
      throw domainError('RATE_LIMITED', 429, details);
    }
    this.inFlight += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.inFlight -= 1;
      },
    };
  }

  private async consume(key: string, rule: RateLimitRule, now: Date): Promise<void> {
    const result = await this.rateLimiter.consume(key, rule, now);
    if (!result.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: result.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
  }

  /** Приём файла: `created` — новая загрузка (`202`), иначе тот же файл уже есть (`200`). */
  async accept(
    userId: string,
    fileName: string | null,
    bytes: Uint8Array,
  ): Promise<{ created: boolean; upload: TrackUpload }> {
    if (bytes.byteLength === 0) {
      throw domainError('VALIDATION_FAILED', 400, { fields: [{ path: 'body', code: 'INVALID' }] });
    }
    if (bytes.byteLength > TRACKS_POLICY.maxFileBytes) throw domainError('TRACK_TOO_LARGE', 413);
    const format = detectTrackFormat(bytes);
    if (!format) throw domainError('TRACK_FORMAT_UNSUPPORTED', 415);
    try {
      const { upload, created } = await this.sources.store({
        userId,
        source: 'upload',
        via: null,
        sourceRef: null,
        format,
        fileName,
        bytes,
      });
      return { created, upload: await this.view(upload) };
    } catch (error) {
      if (error instanceof TrackStorageFullError) throw domainError('TRACK_STORAGE_FULL', 503);
      throw error;
    }
  }

  async get(userId: string, id: string): Promise<TrackUpload> {
    const upload = await this.repository.findOwnUpload(userId, id);
    if (!upload) throw domainError('NOT_FOUND', 404);
    return this.view(upload);
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<TrackUploadPage> {
    const afterId = cursor ? decodeCursor(cursor, TrackUploadCursorKey).id : null;
    const uploads = await this.repository.listOwnUploads(userId, afterId, limit + 1);
    const page = uploads.slice(0, limit);
    const activities = await this.repository.activitiesByIds(
      page.map((upload) => upload.activityId).filter((id): id is string => id !== null),
    );
    const byId = new Map(activities.map((activity) => [activity._id, activity]));
    const last = page.at(-1);
    return {
      items: page.map((upload) =>
        toTrackUpload(upload, upload.activityId ? byId.get(upload.activityId) : undefined),
      ),
      nextCursor: uploads.length > limit && last ? encodeCursor('u', last._id) : null,
    };
  }

  /** Удаление своей загрузки (иначе 404). */
  async delete(userId: string, id: string): Promise<void> {
    if (!(await this.remove(userId, id))) throw domainError('NOT_FOUND', 404);
  }

  /** Удаление загрузок источника пользователя (отключение устройства с галочкой). */
  async deleteSource(userId: string, source: TrackSource): Promise<number> {
    let removed = 0;
    for (const id of await this.repository.listSourceUploadIds(userId, source)) {
      if (await this.remove(userId, id)) removed += 1;
    }
    return removed;
  }

  /**
   * Транзакция { замок активностей → загрузка, активность, линия → перевыбор основной группы → outbox
   * `tracks.activity-removed` (была активность); источник провайдера — outbox `tracks.upload-deleted` } → затем файл
   * (сбой — подберёт уборка «файлы без документа»).
   */
  private async remove(userId: string, id: string): Promise<boolean> {
    const now = this.clock.now();
    const removed = await this.transactions.run(async (session) => {
      await this.repository.lockUserActivities(session, userId);
      const result = await this.repository.deleteUploadCascade(session, userId, id);
      if (!result) return undefined;
      if (result.activity) {
        const primaryActivityId = await regroupAfterDelete(
          this.repository,
          session,
          result.activity,
          now,
        );
        await this.outbox.append(session, {
          type: TRACK_ACTIVITY_REMOVED,
          payload: {
            activityId: result.activity._id,
            uploadId: result.upload._id,
            userId,
            primaryActivityId,
          },
        });
      }
      if (result.upload.sourceRef) {
        // устойчивый маркер: повтор импорта (в том числе до события ниже) заезд не вернёт
        await this.repository.markSourceRefDeleted(
          session,
          sourceRefKey(result.upload.source, result.upload.sourceRef),
          userId,
          now,
        );
        await this.outbox.append(session, {
          type: TRACK_UPLOAD_DELETED,
          payload: {
            uploadId: result.upload._id,
            userId,
            source: result.upload.source,
            sourceRef: result.upload.sourceRef,
          },
        });
      }
      return result.upload;
    });
    if (!removed) return false;
    if (removed.storageKey) {
      await this.files.delete(removed.storageKey).catch(() => undefined);
      await this.sources.invalidateUsage();
    }
    this.logger.log(`upload ${removed._id} deleted`);
    return true;
  }

  private async view(upload: TrackUploadDoc): Promise<TrackUpload> {
    const [activity] = upload.activityId
      ? await this.repository.activitiesByIds([upload.activityId])
      : [];
    return toTrackUpload(upload, activity);
  }
}
