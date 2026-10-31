import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ImageInvalidDetails,
  RIDE_PHOTO_MAX_EDGE_PX,
  RIDE_PHOTO_MIN_SHORT_PX,
  type RateLimitedDetails,
  type RideView,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter, type RateLimitRule } from '@rkarakulov/api-kit/core';
import { Binary } from 'mongodb';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import type { UploadSlot } from '../../upload-slots';
import { randomToken } from '../identity';
import { ImageProcessing, ImageUploadSlots, processCover } from '../media';
import { RidePhotosRepository } from './ride-photos.repository';
import { RIDES_POLICY } from './rides.policy';
import { RidesRepository } from './rides.repository';
import { RidesService } from './rides.service';

const limited = (retryAfterSec: number) => {
  const details: RateLimitedDetails = { retryAfterSec };
  return domainError('RATE_LIMITED', 429, details);
};

const invalid = (reason: ImageInvalidDetails['reason']) => {
  const details: ImageInvalidDetails = { reason };
  return domainError('IMAGE_INVALID', 422, details);
};

/**
 * Фото организатора кофе-райда (ride-photo, ADR-0028). Приём: свой райд (иначе 404) → будущий опубликованный (409) →
 * общий слот приёма `ImageUploadSlots` (429) → лимит `ride-photo:<uid>` 20/ч (429) — всё до тела; после тела — общее с
 * аватаром место обработки `ImageProcessing` (429) и `processCover`. Замена и удаление — транзакция «райд первым →
 * прежнее фото удалено → новое вставлено» (фильтр записи повторяет права и состояние); `version` райда не меняется.
 * Логи — `ride`, `uid`, размер, формат, исход; без названия, байтов, id фото и сообщений libvips.
 */
@Injectable()
export class RidePhotosService {
  private readonly logger = new Logger(RidePhotosService.name);

  constructor(
    private readonly rides: RidesService,
    private readonly repository: RidesRepository,
    private readonly photos: RidePhotosRepository,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    private readonly processing: ImageProcessing,
    private readonly slots: ImageUploadSlots,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Права, состояние, слот и лимит — до чтения тела; `release` — после ответа. Слот раньше лимита: отказ «слот занят»
   * не списывает часовую квоту; отказ квоты освобождает слот.
   */
  async admit(userId: string, rideId: string): Promise<UploadSlot> {
    const ride = await this.rides.ownRide(userId, rideId);
    this.rides.assertUpcoming(ride, this.clock.now());
    const slot = this.slots.tryAcquire(userId);
    if (!slot) throw limited(5);
    try {
      await this.consume(`ride-photo:${userId}`, RIDES_POLICY.photoUploadLimit);
    } catch (error) {
      slot.release();
      throw error;
    }
    return slot;
  }

  /** Перекодировать и заменить фото; ответ — `RideView` организатора после записи. */
  async replace(userId: string, rideId: string, bytes: Uint8Array): Promise<RideView> {
    // память libvips — одна обработка на процесс на все фото; занято дольше `waitMs` — 429 (квота уже списана)
    const permit = await this.processing.acquire();
    if (!permit) throw limited(5);
    const result = await processCover(bytes, {
      maxEdgePx: RIDE_PHOTO_MAX_EDGE_PX,
      minShortPx: RIDE_PHOTO_MIN_SHORT_PX,
    }).finally(() => permit.release());
    if (!result.ok) {
      this.logger.log(
        `rides.photo_rejected ride=${rideId} uid=${userId} bytes=${bytes.byteLength} format=${result.format ?? 'none'} outcome=${result.error}`,
      );
      if (result.error === 'unsupported') throw domainError('IMAGE_FORMAT_UNSUPPORTED', 415);
      throw invalid(result.error === 'too_small' ? 'too_small' : 'unreadable');
    }
    const now = this.clock.now();
    const id = randomToken();
    const written = await this.transactions.run(async (tx) => {
      // запись райда первой: гонка со сбросом модератором и правкой — write conflict и повтор транзакции
      const before = await this.repository.setPhoto(tx, rideId, userId, id, now);
      if (!before) return false;
      const previous = before.photoId ?? null;
      // уникальный `{ rideId }`: прежнее — до вставки нового
      if (previous !== null) await this.photos.delete(tx, previous, rideId);
      await this.photos.insert(tx, {
        _id: id,
        rideId,
        organizerUserId: userId,
        bytes: new Binary(result.bytes),
        contentType: 'image/jpeg',
        width: result.width,
        height: result.height,
        bytesLength: result.bytes.byteLength,
        createdAt: now,
      });
      return true;
    });
    if (!written) {
      // условие фильтра не выполнено после приёма тела: причину — по свежему документу
      const fresh = await this.rides.ownRide(userId, rideId);
      this.rides.assertUpcoming(fresh, now);
      throw domainError('RIDE_INVALID_STATE', 409);
    }
    this.logger.log(
      `rides.photo_replaced ride=${rideId} uid=${userId} bytes=${bytes.byteLength} format=${result.format} stored=${result.bytes.byteLength}`,
    );
    return this.viewAfter(userId, rideId, now);
  }

  /** Удалить фото своего райда — любой статус, идемпотентно; лимит — общий `rides-manage`. */
  async remove(userId: string, rideId: string): Promise<RideView> {
    await this.consume(`rides-manage:${userId}`, RIDES_POLICY.manageLimit);
    const now = this.clock.now();
    const before = await this.transactions.run(async (tx) => {
      const doc = await this.repository.clearPhoto(tx, rideId, userId, now);
      if (doc?.photoId) await this.photos.delete(tx, doc.photoId, rideId);
      return doc;
    });
    if (before) this.logger.log(`rides.photo_removed ride=${rideId} uid=${userId}`);
    return this.viewAfter(userId, rideId, now);
  }

  /** Байты фото для публичной отдачи: только текущее фото нескрытого райда; иначе 404. */
  async bytes(id: string): Promise<Buffer> {
    const doc = await this.photos.findBytes(id);
    if (!doc || !(await this.repository.isCurrentPhoto(doc.rideId, id))) {
      throw domainError('NOT_FOUND', 404);
    }
    const { buffer } = doc.bytes;
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  /** Вид организатора после записи (свежее чтение; чужой и неизвестный — 404). */
  private async viewAfter(userId: string, rideId: string, now: Date): Promise<RideView> {
    return this.rides.viewOf(await this.rides.ownRide(userId, rideId), userId, now, false);
  }

  private async consume(key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.rateLimiter.consume(key, rule, this.clock.now());
    if (!result.allowed) throw limited(result.retryAfterSec);
  }
}
