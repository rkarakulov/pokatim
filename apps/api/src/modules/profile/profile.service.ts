import { Inject, Injectable } from '@nestjs/common';
import {
  type AppThemeId,
  PUBLIC_NAME_CONSENT_VERSION,
  type ProfileView,
  type RateLimitedDetails,
  type UpdateProfileRequest,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { randomToken } from '../identity';
import { AvatarReissue } from './avatar-reissue';
import type { ProfileDoc } from './profile.collection';
import { isPublicProfile, PROFILE_POLICY, profileViewOf as viewOf } from './profile.policy';
import { ProfileRepository } from './profile.repository';

type ProfilePatch = {
  publicName?: string | null;
  showNameInResults?: boolean;
  club?: string | null;
};

/**
 * Профиль своего пользователя: ответы опроса для порядка разделов Главной, публичное имя и согласие на показ в
 * таблицах результатов (profile-rider-name), клуб (rider-profile). Документа нет — пустой профиль. Имя и клуб — ПДн:
 * здесь ничего не логируется.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly rateLimiter: RateLimiter,
    private readonly transactions: MongoTransactions,
    private readonly reissue: AvatarReissue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(userId: string): Promise<ProfileView> {
    return viewOf(await this.repository.findProfile(userId));
  }

  /**
   * Частичное обновление имени и согласия; лимит `profile-update` — до транзакции (Redis вне колбэка). Ответ —
   * профиль после записи. Фактическая смена согласия пишет событие журнала (profile-02, D4) в той же транзакции:
   * прежний флаг читается внутри неё до записи того же документа — параллельный `PATCH` конфликтует и повторяется
   * на свежем снимке (двойного `granted` нет). Версия текста и время — сервер.
   */
  async update(userId: string, body: UpdateProfileRequest): Promise<ProfileView> {
    const now = this.clock.now();
    const limited = await this.rateLimiter.consume(
      `profile-update:${userId}`,
      PROFILE_POLICY.updateLimit,
      now,
    );
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    const patch: ProfilePatch = {
      publicName: body.publicName,
      showNameInResults: body.showNameInResults,
      club: body.club,
    };
    // кандидат id публичного профиля — до транзакции (rider-profile, R-3): пригодится только при первом «имя + согласие»;
    // новый id фото (profile-moderation, RC-A2 (b)) — только при уходе профиля из публичного доступа
    const ids = { publicId: randomToken(), avatarId: randomToken() };
    try {
      return viewOf(await this.writeProfile(userId, patch, ids, now));
    } catch (error) {
      // гонка двух первых upsert: документ уже вставлен — повтор всей транзакции его найдёт и обновит
      if (!isDuplicateKey(error, '_id_')) throw error;
      return viewOf(await this.writeProfile(userId, patch, ids, now));
    }
  }

  /**
   * Личная тема (user-theme): лимит `profile-theme` — до записи; одна атомарная операция над своим документом без
   * транзакции и журнала (тема — не ПДн и не публичное). Ответ — профиль после записи.
   */
  async setTheme(userId: string, themeId: AppThemeId): Promise<ProfileView> {
    const now = this.clock.now();
    const limited = await this.rateLimiter.consume(
      `profile-theme:${userId}`,
      PROFILE_POLICY.themeUpdateLimit,
      now,
    );
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    try {
      return viewOf(await this.repository.setTheme(userId, themeId, now));
    } catch (error) {
      // гонка двух первых upsert: документ уже вставлен — повтор его найдёт и обновит
      if (!isDuplicateKey(error, '_id_')) throw error;
      return viewOf(await this.repository.setTheme(userId, themeId, now));
    }
  }

  /**
   * Транзакция `PATCH`: прежний профиль → запись профиля (первая запись) → событие согласия → перевыпуск id фото, если
   * профиль был публичен и перестал (отзыв согласия или очистка имени; profile-moderation, RC-A2 (b)).
   */
  private writeProfile(
    userId: string,
    patch: ProfilePatch,
    ids: { publicId: string; avatarId: string },
    now: Date,
  ): Promise<ProfileDoc> {
    return this.transactions.run(async (tx) => {
      const before = await this.repository.findProfile(userId, tx);
      const wasShown = before?.showNameInResults ?? false;
      const after = await this.repository.updatePublicName(tx, userId, patch, ids.publicId, now);
      const shown = after.showNameInResults ?? false;
      if (shown !== wasShown) {
        await this.repository.insertConsentEvent(tx, {
          _id: uuidv7(),
          userId,
          kind: 'public_name',
          action: shown ? 'granted' : 'revoked',
          version: PUBLIC_NAME_CONSENT_VERSION,
          at: now,
        });
      }
      if (isPublicProfile(before) && !isPublicProfile(after) && after.avatarId) {
        const avatarId = await this.reissue.reissue(tx, userId, after.avatarId, ids.avatarId, now);
        return { ...after, avatarId };
      }
      return after;
    });
  }
}
