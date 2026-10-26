import { Inject, Injectable } from '@nestjs/common';
import type { ProfileView, RateLimitedDetails, UpdateProfileRequest } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { domainError } from '../../error-messages';
import type { ProfileDoc } from './profile.collection';
import { PROFILE_POLICY } from './profile.policy';
import { ProfileRepository } from './profile.repository';

const viewOf = (
  doc: Pick<ProfileDoc, 'rideReasons' | 'publicName' | 'showNameInResults'> | null,
): ProfileView => ({
  rideReasons: doc?.rideReasons ?? [],
  publicName: doc?.publicName ?? null,
  showNameInResults: doc?.showNameInResults ?? false,
});

/**
 * Профиль своего пользователя: ответы опроса для порядка разделов Главной, публичное имя и согласие на показ в
 * таблицах результатов (profile-rider-name). Документа нет — пустой профиль. Имя — ПДн: здесь ничего не логируется.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(userId: string): Promise<ProfileView> {
    return viewOf(await this.repository.findProfile(userId));
  }

  /** Частичное обновление имени и согласия; лимит `profile-update` — до записи. Ответ — профиль после записи. */
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
    const patch = { publicName: body.publicName, showNameInResults: body.showNameInResults };
    try {
      return viewOf(await this.repository.updatePublicName(userId, patch, now));
    } catch (error) {
      // гонка двух первых upsert: документ уже вставлен — повтор его найдёт и обновит
      if (!isDuplicateKey(error, '_id_')) throw error;
      return viewOf(await this.repository.updatePublicName(userId, patch, now));
    }
  }
}
