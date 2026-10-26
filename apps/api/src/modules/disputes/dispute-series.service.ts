import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { PanelDisputeSeries, RateLimitedDetails } from '@pokatim/contracts';
import { CLOCK, type Clock, RateLimiter } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';
import type { Queue } from 'bullmq';

import { domainError } from '../../error-messages';
import { QUEUE } from '../../queues';
import { PanelAudit, type PanelPrincipal } from '../panel';
import { RACE_REGISTRY, type RaceRegistry } from '../races';
import { RESULTS_FOR_DISPUTES, type ResultsForDisputes } from '../results';
import {
  DISPUTE_SERIES_BUILD_JOB,
  DisputeSeriesCache,
  type DisputeSeriesJob,
} from './dispute-series.cache';
import type { DisputeDoc } from './disputes.collection';
import { DISPUTE_SERIES_POLICY } from './disputes.policy';
import { DisputesRepository } from './disputes.repository';
import { disputeNotFound } from './disputes.service';

/**
 * Ряды пульса и мощности на разборе спора (race-results-06b, `disputes.read`): только оспоренный результат (лучшая
 * засчитанная попытка цели, сегмент между воротами — решает сервер). HTTP читает кэш Redis и ставит задачу
 * `dispute-series`; разбор — только worker. Просмотр — журнал `disputes.series_viewed` раз в час на (сотрудник, спор).
 * В MongoDB и логи значения рядов не попадают.
 */
@Injectable()
export class DisputeSeriesService {
  constructor(
    private readonly repository: DisputesRepository,
    private readonly cache: DisputeSeriesCache,
    private readonly audit: PanelAudit,
    private readonly transactions: MongoTransactions,
    private readonly rateLimiter: RateLimiter,
    @InjectQueue(QUEUE.disputeSeries) private readonly queue: Queue,
    @Inject(RACE_REGISTRY) private readonly races: RaceRegistry,
    @Inject(RESULTS_FOR_DISPUTES) private readonly results: ResultsForDisputes,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(principal: PanelPrincipal, disputeId: string): Promise<PanelDisputeSeries> {
    const dispute = await this.repository.findById(disputeId);
    if (!dispute) throw disputeNotFound();
    await this.recordView(principal.userId, dispute);

    const segment = await this.results.bestSegment(dispute.targetEntryId);
    if (!segment) return { state: 'unavailable', reason: 'no_result' };
    const cached = await this.cache.read(segment.attemptId, segment.checkRevision);
    if (cached?.kind === 'ready') return { state: 'ready', series: cached.series };
    if (cached?.kind === 'failed') return { state: 'unavailable', reason: cached.reason };

    if (await this.cache.claim(segment.attemptId, segment.checkRevision)) {
      const limit = await this.rateLimiter.consume(
        `dispute-series-user:${principal.userId}`,
        DISPUTE_SERIES_POLICY.staffLimit,
        this.clock.now(),
      );
      if (!limit.allowed) {
        await this.cache.release(segment.attemptId, segment.checkRevision);
        const details: RateLimitedDetails = { retryAfterSec: limit.retryAfterSec };
        throw domainError('RATE_LIMITED', 429, details);
      }
      const data: DisputeSeriesJob = {
        entryId: dispute.targetEntryId,
        attemptId: segment.attemptId,
        checkRevision: segment.checkRevision,
      };
      try {
        await this.queue.add(DISPUTE_SERIES_BUILD_JOB, data, {
          attempts: DISPUTE_SERIES_POLICY.jobAttempts,
          backoff: { type: 'exponential', delay: DISPUTE_SERIES_POLICY.jobBackoffMs },
          removeOnComplete: true,
          removeOnFail: true,
        });
      } catch (error) {
        await this.cache.release(segment.attemptId, segment.checkRevision);
        throw error;
      }
    }
    return { state: 'preparing' };
  }

  /** Журнал доступа к биометрии: первая запись за час — в транзакции; сбой записи снимает отметку. */
  private async recordView(staffId: string, dispute: DisputeDoc): Promise<void> {
    if (!(await this.cache.markViewed(staffId, dispute._id))) return;
    try {
      const race = await this.races.get(dispute.raceId);
      await this.transactions.run(async (tx) => {
        await this.audit.append(tx, {
          action: 'disputes.series_viewed',
          actor: { kind: 'user', userId: staffId },
          subject: { kind: 'race', id: dispute.raceId, label: race?.title ?? '' },
          details: { disputeId: dispute._id, entryId: dispute.targetEntryId },
        });
      });
    } catch (error) {
      await this.cache.unmarkViewed(staffId, dispute._id);
      throw error;
    }
  }
}
