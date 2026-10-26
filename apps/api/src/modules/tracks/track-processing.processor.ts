import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { CLOCK, type Clock, type OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader, MongoTransactions, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { insertGrouped } from './activity-groups';
import { analyzeInThread, type ParseLimits, type ParseOutcome } from './track-parse.thread';
import { TRACK_FILE_STORE, type TrackFileStore } from './track-file-store';
import type { ActivityDoc, TrackUploadDoc } from './tracks.collection';
import { TRACK_UPLOAD_RECEIVED, TrackUploadReceived } from './tracks.events';
import { TRACKS_POLICY } from './tracks.policy';
import { TracksRepository } from './tracks.repository';

export type TrackProcessingOutcome = 'ready' | 'duplicate' | 'failed' | 'skipped';

/**
 * Разбор загрузки (`track-processing`, jobId = id события outbox): захват по статусу (`queued`/`processing`;
 * финальная — no-op, повтор outbox безопасен) → исходник из хранилища → `analyzeTrack` в потоке с лимитами → отказ
 * `failed: <код>` или транзакция { `lockUserActivities` → активность + линия → группа дублей → статус загрузки }.
 * Параллелизм процессора — 1 (память worker-контейнера).
 */
@Processor(QUEUE.trackProcessing, { concurrency: 1 })
export class TrackProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackProcessingProcessor.name);
  /** Лимиты потока разбора (тест «долгий разбор» уменьшает таймаут). */
  parseLimits: ParseLimits = TRACKS_POLICY.parseLimits;

  constructor(
    private readonly repository: TracksRepository,
    private readonly outbox: MongoOutboxReader,
    private readonly transactions: MongoTransactions,
    @Inject(TRACK_FILE_STORE) private readonly files: TrackFileStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<TrackProcessingOutcome> {
    if (job.name !== TRACK_UPLOAD_RECEIVED) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.trackProcessing}`);
    }
    const payload = TrackUploadReceived.safeParse(
      await this.outbox.payloadOf(job.data.outboxEventId),
    );
    if (!payload.success) {
      this.logger.warn(`event ${job.data.outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    // последняя попытка BullMQ: сбой окружения — финальный отказ загрузки, а не вечное `processing`
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return this.processUpload(payload.data.uploadId, { finalAttempt });
  }

  /** Разбор в потоке с лимитами (точка подмены в тестах сбоя потока). */
  analyze(bytes: Uint8Array, format: TrackUploadDoc['format']): Promise<ParseOutcome> {
    return analyzeInThread(bytes, format, this.clock.now(), this.parseLimits);
  }

  /**
   * Обработка одной загрузки (вызывается и тестами напрямую). Исходника нет (уборка, потеря тома) — `failed:
   * storage` сразу; сбой окружения (загрузчик модуля, падение потока) — исключение и ретрай BullMQ, на последней
   * попытке — `failed: unreadable` (пользователь видит итог, загрузка не висит в «Обрабатываем…»).
   */
  async processUpload(
    uploadId: string,
    { finalAttempt = false }: { finalAttempt?: boolean } = {},
  ): Promise<TrackProcessingOutcome> {
    const upload = await this.repository.claimUpload(uploadId, this.clock.now());
    if (!upload) return 'skipped';
    if (!upload.storageKey) {
      await this.repository.failUpload(upload._id, 'storage', this.clock.now());
      return 'failed';
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.files.get(upload.storageKey);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !finalAttempt) throw error;
      await this.repository.failUpload(upload._id, 'storage', this.clock.now());
      this.logger.warn(`upload ${upload._id} failed: storage`);
      return 'failed';
    }
    let outcome: ParseOutcome;
    try {
      outcome = await this.analyze(bytes, upload.format);
    } catch (error) {
      if (!finalAttempt) throw error;
      await this.repository.failUpload(upload._id, 'unreadable', this.clock.now());
      this.logger.warn(`upload ${upload._id} failed on final attempt: parser error`);
      return 'failed';
    }
    if (!outcome.ok) {
      await this.repository.failUpload(upload._id, outcome.failure, this.clock.now());
      this.logger.log(`upload ${upload._id} failed: ${outcome.failure}`);
      return 'failed';
    }
    return this.record(upload, outcome);
  }

  private async record(
    upload: TrackUploadDoc,
    outcome: Extract<ParseOutcome, { ok: true }>,
  ): Promise<TrackProcessingOutcome> {
    const { analysis } = outcome;
    const now = this.clock.now();
    const activity: ActivityDoc = {
      _id: uuidv7(),
      userId: upload.userId,
      uploadId: upload._id,
      source: upload.source,
      sport: analysis.sport,
      startedAt: analysis.startedAt,
      endedAt: analysis.endedAt,
      elapsedSec: analysis.elapsedSec,
      movingSec: analysis.movingSec,
      distanceM: analysis.distanceM,
      elevationGainM: analysis.elevationGainM,
      hasHeartRate: analysis.hasHeartRate,
      hasPower: analysis.hasPower,
      startPoint: { type: 'Point', coordinates: analysis.startPoint },
      duplicateOf: null,
      createdAt: now,
    };
    // линия — только из ≥ 2 различных точек (иначе 2dsphere отвергнет документ): пакет даёт [] для вырожденной
    const track =
      analysis.line.length >= 2
        ? {
            _id: activity._id,
            userId: upload.userId,
            line: { type: 'LineString' as const, coordinates: analysis.line },
            sourcePointCount: analysis.sourcePointCount,
          }
        : null;
    const primaryId = await this.transactions.run(async (session) => {
      await this.repository.lockUserActivities(session, upload.userId);
      // загрузку успели удалить или обработать (повтор задачи) — ничего не пишем
      if (!(await this.repository.attachActivity(session, upload._id, activity._id, now))) {
        return null;
      }
      return insertGrouped(this.repository, session, activity, track, now);
    });
    if (primaryId === null) return 'skipped';
    const status = primaryId === activity._id ? 'ready' : 'duplicate';
    this.logger.log(`upload ${upload._id} ${status}`);
    return status;
  }
}
