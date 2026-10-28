import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AVATAR_SIZE_PX,
  type AvatarCropQuery,
  type ProfileView,
  type RateLimitedDetails,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter, type RateLimitRule } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';
import { Binary } from 'mongodb';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { type UploadSlot, UploadSlots } from '../../upload-slots';
import { randomToken } from '../identity';
import { type CropIntent, processAvatar } from './avatar-image';
import { AvatarProcessing } from './avatar-processing-gate';
import { ProfileAvatarRepository } from './profile-avatar.repository';
import { PROFILE_POLICY, profileViewOf } from './profile.policy';
import { ProfileRepository } from './profile.repository';

const limited = (retryAfterSec: number) => {
  const details: RateLimitedDetails = { retryAfterSec };
  return domainError('RATE_LIMITED', 429, details);
};

/**
 * Аватар своего профиля (rider-profile, ADR-0019): слот чтения тела (4 на процесс, 1 на пользователя) и лимит
 * `profile-avatar:<uid>` 20/ч — до тела; место обработки sharp (1 на процесс, ожидание до 5 с) — после тела; перекодирование `processAvatar`; замена — транзакция «новый документ → профиль → прежний
 * удалён»; удаление — транзакция «профиль → прежний удалён». В логах — `uid`, размер, формат и исход (без имени,
 * клуба и сообщений libvips).
 */
@Injectable()
export class ProfileAvatarService {
  private readonly logger = new Logger(ProfileAvatarService.name);
  private readonly slots = new UploadSlots(PROFILE_POLICY.avatarSlots);

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly avatars: ProfileAvatarRepository,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    private readonly processing: AvatarProcessing,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Слот приёма, затем лимит частоты — до чтения тела; `release` — после ответа. Слот первым (LOW-1 ревью): отказ «слот
   * занят» не списывает часовую квоту; отказ квоты освобождает слот.
   */
  async admit(userId: string): Promise<UploadSlot> {
    const slot = this.slots.tryAcquire(userId);
    if (!slot) throw limited(5);
    try {
      await this.consume(`profile-avatar:${userId}`, PROFILE_POLICY.avatarUploadLimit);
    } catch (error) {
      slot.release();
      throw error;
    }
    return slot;
  }

  /** Перекодировать и заменить аватар; ответ — профиль после записи. */
  async replace(userId: string, bytes: Uint8Array, crop: AvatarCropQuery): Promise<ProfileView> {
    const intent: CropIntent | null =
      'size' in crop ? { x: crop.x, y: crop.y, size: crop.size } : null;
    // память libvips — одна обработка на процесс; занято дольше `waitMs` — 429 (тело уже прочитано, квота списана)
    const permit = await this.processing.acquire();
    if (!permit) throw limited(5);
    const result = await processAvatar(bytes, intent).finally(() => permit.release());
    if (!result.ok) {
      this.logger.log(
        `profile.avatar_rejected uid=${userId} bytes=${bytes.byteLength} format=${result.format ?? 'none'} outcome=${result.error}`,
      );
      throw result.error === 'unsupported'
        ? domainError('AVATAR_FORMAT_UNSUPPORTED', 415)
        : domainError('AVATAR_INVALID', 422);
    }
    const now = this.clock.now();
    const id = randomToken();
    const doc = {
      _id: id,
      userId,
      bytes: new Binary(result.bytes),
      contentType: 'image/jpeg' as const,
      width: AVATAR_SIZE_PX,
      height: AVATAR_SIZE_PX,
      bytesLength: result.bytes.byteLength,
      createdAt: now,
    };
    const write = () =>
      this.transactions.run(async (tx) => {
        const before = await this.profiles.findProfile(userId, tx);
        await this.avatars.insert(tx, doc);
        const after = await this.profiles.setAvatar(tx, userId, id, now);
        const previous = before?.avatarId ?? null;
        if (previous !== null && previous !== id) await this.avatars.delete(tx, previous, userId);
        return after;
      });
    let after;
    try {
      after = await write();
    } catch (error) {
      // гонка двух первых upsert профиля: документ уже вставлен — повтор найдёт его и заменит аватар
      if (!isDuplicateKey(error, '_id_')) throw error;
      after = await write();
    }
    this.logger.log(
      `profile.avatar_replaced uid=${userId} bytes=${bytes.byteLength} format=${result.format} stored=${result.bytes.byteLength}`,
    );
    return profileViewOf(after);
  }

  /** Удалить фото — идемпотентно (нет профиля или фото — текущий вид); лимит — общий `profile-update`. */
  async remove(userId: string): Promise<ProfileView> {
    await this.consume(`profile-update:${userId}`, PROFILE_POLICY.updateLimit);
    const now = this.clock.now();
    const before = await this.transactions.run(async (tx) => {
      const doc = await this.profiles.clearAvatar(tx, userId, now);
      const previous = doc?.avatarId ?? null;
      if (previous !== null) await this.avatars.delete(tx, previous, userId);
      return doc;
    });
    if (before?.avatarId) this.logger.log(`profile.avatar_removed uid=${userId}`);
    return profileViewOf(before ? { ...before, avatarId: null } : null);
  }

  /** Байты аватара для публичной отдачи; нет — 404. */
  async bytes(id: string): Promise<Buffer> {
    const bytes = await this.avatars.findBytes(id);
    if (!bytes) throw domainError('NOT_FOUND', 404);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private async consume(key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.rateLimiter.consume(key, rule, this.clock.now());
    if (!result.allowed) throw limited(result.retryAfterSec);
  }
}
