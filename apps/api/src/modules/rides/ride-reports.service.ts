import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CreateRideReportRequest, RateLimitedDetails, RideView } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { isDuplicateKey, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { domainError } from '../../error-messages';
import { RIDE_REPORTS_UNIQUE_INDEX, RideReportsRepository } from './ride-reports.repository';
import { rideViewOf } from './rides-feed.service';
import type { RideDoc } from './rides.collection';
import { RIDES_POLICY, visibleTo } from './rides.policy';
import { RidesRepository } from './rides.repository';

/**
 * Жалоба на кофе-райд (05b, 8.1 D1, D2): одна от пользователя на райд, организатор не жалуется, скрытый чужому —
 * 404. Транзакция: **первой** — условная запись райда (`$inc openReportCount`, `$max lastReportAt`), затем вставка
 * жалобы; конкурирующее «Скрыть» пишет тот же документ первым — транзакции конфликтуют, жалоба не «проскочит»
 * закрытие. Дубль по уникальному индексу — откат всей транзакции и идемпотентный успех. Логи — без комментария.
 */
@Injectable()
export class RideReportsService {
  private readonly logger = new Logger(RideReportsService.name);

  constructor(
    private readonly rides: RidesRepository,
    private readonly reports: RideReportsRepository,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async report(userId: string, id: string, body: CreateRideReportRequest): Promise<RideView> {
    const limited = await this.rateLimiter.consume(
      `rides-report:${userId}`,
      RIDES_POLICY.reportLimit,
      this.clock.now(),
    );
    if (!limited.allowed) {
      const details: RateLimitedDetails = { retryAfterSec: limited.retryAfterSec };
      throw domainError('RATE_LIMITED', 429, details);
    }
    const now = this.clock.now();
    const doc = this.assertReportable(await this.rides.findForViewer(id, userId), userId);
    if (await this.reports.exists(id, userId)) return rideViewOf(doc, userId, now, true);

    let recorded = false;
    try {
      recorded = await this.transactions.run(async (tx) => {
        if (!(await this.rides.recordReport(tx, id, userId, now))) return false;
        await this.reports.insert(tx, {
          _id: uuidv7(),
          rideId: id,
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
      if (!isDuplicateKey(error, RIDE_REPORTS_UNIQUE_INDEX)) throw error;
      recorded = true;
    }
    const fresh = await this.rides.findForViewer(id, userId);
    // условие записи не выполнено между чтением и транзакцией: причину — по свежему документу
    if (!recorded) this.assertReportable(fresh, userId);
    else this.logger.log(`rides.reported ride=${id} uid=${userId} reason=${body.reason}`);
    return rideViewOf(fresh ?? doc, userId, now, true);
  }

  /** Нет или скрыт (чужому) — 404; свой — 409 `RIDE_INVALID_STATE`. */
  private assertReportable(doc: RideDoc | undefined, userId: string): RideDoc {
    if (!doc || !visibleTo(doc, userId)) throw domainError('NOT_FOUND', 404);
    if (doc.organizerUserId === userId) throw domainError('RIDE_INVALID_STATE', 409);
    return doc;
  }
}
