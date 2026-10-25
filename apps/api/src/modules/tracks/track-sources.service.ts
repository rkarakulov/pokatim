import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TrackFormat, TrackSource } from '@pokatim/contracts';
import { CLOCK, type Clock, ENV, REDIS } from '@rkarakulov/api-kit/core';
import {
  isDuplicateKey,
  MongoOutboxWriter,
  MongoTransactions,
  uuidv7,
} from '@rkarakulov/api-kit/mongo';
import type { Redis } from 'ioredis';

import type { Env } from '../../config/env';
import type { DbSession } from '../../db';
import { newStorageKey, TRACK_FILE_STORE, type TrackFileStore } from './track-file-store';
import {
  TrackIngestPreconditionError,
  TrackSourceDeletedError,
  TrackStorageFullError,
} from './track-ingest.port';
import type { TrackUploadDoc, TrackVia } from './tracks.collection';
import { TRACK_UPLOAD_RECEIVED } from './tracks.events';
import { TRACKS_POLICY } from './tracks.policy';
import { sourceRefKey, TracksRepository } from './tracks.repository';

/** Ключ кеша суммы хранимых байт (квота): общий для API и worker. */
const USAGE_CACHE_KEY = 'tracks:storage:used-bytes';

export interface StoreSourceInput {
  userId: string;
  source: TrackSource;
  via: TrackVia | null;
  sourceRef: string | null;
  format: TrackFormat;
  fileName: string | null;
  bytes: Uint8Array;
  /** Барьер вызывающего внутри транзакции приёма (`TrackIngest`). */
  precondition?: (session: DbSession) => Promise<boolean>;
}

export interface StoreSourceResult {
  upload: TrackUploadDoc;
  /** `false` — тот же файл пользователя или тот же объект источника уже есть (идемпотентный повтор). */
  created: boolean;
}

/**
 * Приём исходника — общий путь ручной загрузки и потока агрегатора (§5): sha256 → тот же исходник уже есть → он же;
 * квота хранилища → файл (временное имя → `rename`) → транзакция { загрузка `queued` + outbox
 * `tracks.upload-received` }. Гонку одинаковых исходников ловят уникальные индексы: проигравший удаляет свой файл
 * и возвращает загрузку победителя.
 */
@Injectable()
export class TrackSourcesService {
  private readonly logger = new Logger(TrackSourcesService.name);

  constructor(
    private readonly repository: TracksRepository,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(TRACK_FILE_STORE) private readonly files: TrackFileStore,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async store(input: StoreSourceInput): Promise<StoreSourceResult> {
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const existing = await this.existing(input, sha256);
    if (existing) return { upload: existing, created: false };
    const refKey = input.sourceRef ? sourceRefKey(input.source, input.sourceRef) : null;
    // объект источника пользователь удалял — не воскрешаем (ранний отказ до записи файла)
    if (refKey && (await this.repository.isSourceRefDeleted(refKey))) {
      throw new TrackSourceDeletedError();
    }

    await this.assertCapacity(input.bytes.byteLength);
    const storageKey = newStorageKey(input.format);
    await this.files.put(storageKey, input.bytes);

    const now = this.clock.now();
    const upload: TrackUploadDoc = {
      _id: uuidv7(),
      userId: input.userId,
      source: input.source,
      via: input.via,
      sourceRef: input.sourceRef,
      format: input.format,
      fileName: input.fileName,
      sizeBytes: input.bytes.byteLength,
      sha256,
      storageKey,
      status: 'queued',
      failure: null,
      attempts: 0,
      activityId: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.transactions.run(async (session) => {
        if (input.precondition && !(await input.precondition(session))) {
          throw new TrackIngestPreconditionError();
        }
        if (refKey) await this.repository.claimSourceRef(session, refKey, input.userId, now);
        await this.repository.insertUpload(session, upload);
        await this.outbox.append(session, {
          type: TRACK_UPLOAD_RECEIVED,
          payload: { uploadId: upload._id },
        });
      });
    } catch (error) {
      await this.files.delete(storageKey).catch(() => undefined);
      if (error instanceof TrackIngestPreconditionError) throw error;
      // удаление закоммитилось между ранней проверкой и транзакцией: маркер `deleted` — `11000` на `_id_` маркера
      if (refKey && (await this.repository.isSourceRefDeleted(refKey))) {
        throw new TrackSourceDeletedError();
      }
      const raced =
        isDuplicateKey(error, 'track_uploads_user_sha_unique') ||
        isDuplicateKey(error, 'track_uploads_source_ref_unique');
      const winner = raced ? await this.existing(input, sha256) : undefined;
      if (winner) return { upload: winner, created: false };
      throw error;
    }
    await this.invalidateUsage();
    this.logger.log(`upload ${upload._id} queued (${upload.source}, ${upload.format})`);
    return { upload, created: true };
  }

  private async existing(input: StoreSourceInput, sha256: string) {
    if (input.sourceRef) {
      const bySource = await this.repository.findUploadBySourceRef(input.source, input.sourceRef);
      if (bySource) return bySource;
    }
    return this.repository.findUploadBySha(input.userId, sha256);
  }

  /** Квота суммы байт (кеш Redis 60 с) и свободное место тома; иначе `TrackStorageFullError`. */
  private async assertCapacity(size: number): Promise<void> {
    const used = await this.usedBytes();
    if (used + size > this.env.TRACK_STORAGE_MAX_BYTES) throw new TrackStorageFullError();
    const free = await this.files.freeBytes();
    if (free - size < this.env.TRACK_STORAGE_MIN_FREE_BYTES) throw new TrackStorageFullError();
  }

  private async usedBytes(): Promise<number> {
    const cached = await this.redis.get(USAGE_CACHE_KEY).catch(() => null);
    if (cached !== null && /^\d+$/.test(cached)) return Number(cached);
    const used = await this.repository.storedBytes();
    await this.redis
      .set(USAGE_CACHE_KEY, String(used), 'EX', TRACKS_POLICY.usageCacheSec)
      .catch(() => undefined);
    return used;
  }

  /** Занятое место изменилось (запись, удаление, уборка): кеш квоты пересчитается при следующем приёме. */
  async invalidateUsage(): Promise<void> {
    await this.redis.del(USAGE_CACHE_KEY).catch(() => undefined);
  }
}
