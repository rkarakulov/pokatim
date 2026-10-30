import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CreateProfileReportRequest,
  ProfileStateDetails,
  RateLimitedDetails,
  RiderProfileViewer,
} from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import {
  PROFILE_REPORTS_OPEN_UNIQUE_INDEX,
  ProfileReportsRepository,
} from './profile-reports.repository';
import { PROFILE_POLICY } from './profile.policy';
import { ProfileRepository } from './profile.repository';

/**
 * Жалобы на публичный профиль райдера и состояние зрителя (profile-moderation): одна **открытая** жалоба от
 * пользователя на профиль (после решения модератора — снова можно, S-1); свой — 409 `own_profile`; непубличный и
 * неизвестный — один 404. Транзакция: **первой** — условная запись профиля (`$inc openReportCount`, `reportRevision`,
 * `$max lastReportAt`), затем вставка жалобы: конкурирующий сброс пишет тот же документ — транзакции конфликтуют. Дубль
 * по частичному уникальному индексу — откат и идемпотентный успех. Лог — без `publicId`, цели, комментария и имени.
 */
@Injectable()
export class ProfileReportsService {
  private readonly logger = new Logger(ProfileReportsService.name);

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly reports: ProfileReportsRepository,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET /v1/riders/:publicId/me`: только публичный профиль (иначе 404). */
  async viewer(userId: string, publicId: string): Promise<RiderProfileViewer> {
    const target = await this.profiles.findPublic(publicId);
    if (!target) throw domainError('NOT_FOUND', 404);
    const reported = await this.reports.openExists(target._id, userId);
    return { canReport: target._id !== userId && !reported, reported };
  }

  async report(
    userId: string,
    publicId: string,
    body: CreateProfileReportRequest,
  ): Promise<RiderProfileViewer> {
    const limited = await this.rateLimiter.consume(
      `profile-report:${userId}`,
      PROFILE_POLICY.reportLimit,
      this.clock.now(),
    );
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    const targetUserId = await this.reportableTarget(publicId, userId);
    const done: RiderProfileViewer = { canReport: false, reported: true };
    if (await this.reports.openExists(targetUserId, userId)) return done;

    const now = this.clock.now();
    const reportId = uuidv7();
    let recorded = false;
    try {
      recorded = await this.transactions.run(async (tx) => {
        const target = await this.profiles.recordReport(tx, publicId, userId, body.reason, now);
        if (!target) return false;
        await this.reports.insert(tx, {
          _id: reportId,
          targetUserId: target,
          reporterUserId: userId,
          reason: body.reason,
          comment: body.comment ?? null,
          createdAt: now,
          resolvedAt: null,
          resolution: null,
          resolvedBy: null,
        });
        return true;
      });
    } catch (error) {
      // параллельная жалоба того же пользователя закоммитилась первой — успех без изменений
      if (!isDuplicateKey(error, PROFILE_REPORTS_OPEN_UNIQUE_INDEX)) throw error;
      return done;
    }
    // профиль скрыт между чтением и транзакцией: причина — по свежему документу
    if (!recorded) {
      await this.reportableTarget(publicId, userId);
      throw domainError('NOT_FOUND', 404);
    }
    this.logger.log(`profile.reported uid=${userId} reason=${body.reason}`);
    return done;
  }

  /** Непубличный и неизвестный — 404; свой — 409 `own_profile`; иначе `userId` цели. */
  private async reportableTarget(publicId: string, userId: string): Promise<string> {
    const target = await this.profiles.findPublic(publicId);
    if (!target) throw domainError('NOT_FOUND', 404);
    if (target._id === userId) {
      throw domainError('PROFILE_INVALID_STATE', 409, {
        reason: 'own_profile',
        until: null,
      } satisfies ProfileStateDetails);
    }
    return target._id;
  }
}
