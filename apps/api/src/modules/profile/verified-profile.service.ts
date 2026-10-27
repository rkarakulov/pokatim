import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type RateLimitedDetails,
  type UpdateVerifiedProfileRequest,
  VERIFIED_PROFILE_CONSENT_VERSION,
  type VerifiedProfileView,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey } from '@rkarakulov/api-kit/mongo';

import { domainError } from '../../error-messages';
import { IdentityAccounts } from '../identity';
import { PROFILE_POLICY } from './profile.policy';
import type { RiderVerifiedProfileDoc } from './verified-profile.collection';
import { VerifiedProfileRepository } from './verified-profile.repository';

const profileOf = (doc: RiderVerifiedProfileDoc): NonNullable<VerifiedProfileView['profile']> => ({
  gender: doc.gender,
  birthYear: doc.birthYear,
  weightKg: doc.weightKg,
  heightCm: doc.heightCm,
  ftpW: doc.ftpW,
  consentAt: doc.consentAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/**
 * Анкета зачёта Verified своего пользователя (race-results-07). Пол и год после первой Verified-заявки — только те же
 * (`409 VERIFIED_DEMOGRAPHICS_LOCKED`), вес, рост и FTP — всегда. Значения анкеты не логируются (AC14): в логе — id
 * и исход.
 */
@Injectable()
export class VerifiedProfileService {
  private readonly logger = new Logger(VerifiedProfileService.name);

  constructor(
    private readonly repository: VerifiedProfileRepository,
    private readonly accounts: IdentityAccounts,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async view(userId: string): Promise<VerifiedProfileView> {
    const doc = await this.repository.find(userId);
    if (doc) {
      return {
        profile: profileOf(doc),
        demographicsLocked: doc.demographicsLockedAt !== null,
        suggestedBirthYear: null,
      };
    }
    return {
      profile: null,
      demographicsLocked: false,
      suggestedBirthYear: await this.accounts.birthYearOf(userId),
    };
  }

  /**
   * Анкета целиком — одна атомарная операция над документом вне транзакции (`updateOwn` с условием фиксации в
   * фильтре): нет совпадения — документ есть (пол/год зафиксированы и другие → 409) или его нет (`insertOne`; гонка
   * двух первых — duplicate key `_id_` → один повтор всей операции). Лимит — до записи.
   */
  async update(userId: string, body: UpdateVerifiedProfileRequest): Promise<VerifiedProfileView> {
    const now = this.clock.now();
    const limited = await this.rateLimiter.consume(
      `profile-verified-update:${userId}`,
      PROFILE_POLICY.verifiedUpdateLimit,
      now,
    );
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    let created: boolean;
    try {
      created = await this.write(userId, body, now);
    } catch (error) {
      if (!isDuplicateKey(error, '_id_')) throw error;
      created = await this.write(userId, body, now);
    }
    this.logger.log(`verified profile saved uid=${userId} created=${created}`);
    return this.view(userId);
  }

  /** `true` — анкета создана, `false` — обновлена. */
  private async write(
    userId: string,
    body: UpdateVerifiedProfileRequest,
    now: Date,
  ): Promise<boolean> {
    const values = {
      gender: body.gender,
      birthYear: body.birthYear,
      weightKg: body.weightKg,
      heightCm: body.heightCm,
      ftpW: body.ftpW,
    };
    const consent = { at: now, version: VERIFIED_PROFILE_CONSENT_VERSION };
    if (await this.repository.updateOwn(userId, values, consent, now)) return false;
    if (await this.repository.find(userId)) throw domainError('VERIFIED_DEMOGRAPHICS_LOCKED', 409);
    await this.repository.insertOwn({
      _id: userId,
      ...values,
      consentAt: now,
      consentVersion: VERIFIED_PROFILE_CONSENT_VERSION,
      demographicsLockedAt: null,
      updatedAt: now,
      version: 0,
    });
    return true;
  }
}
