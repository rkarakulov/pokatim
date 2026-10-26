import { Inject, Injectable } from '@nestjs/common';
import { type DisputeSeriesUnavailable, PanelDisputeSeriesData } from '@pokatim/contracts';
import { REDIS } from '@rkarakulov/api-kit/core';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { DISPUTE_SERIES_POLICY } from './disputes.policy';

/** Задача очереди `dispute-series`: только id — значения рядов в job data не попадают. */
export const DISPUTE_SERIES_BUILD_JOB = 'dispute-series.build';
export const DisputeSeriesJob = z.object({
  entryId: z.string(),
  attemptId: z.string(),
  checkRevision: z.number().int(),
});
export type DisputeSeriesJob = z.infer<typeof DisputeSeriesJob>;

export type CachedSeries =
  | { kind: 'ready'; series: PanelDisputeSeriesData }
  | { kind: 'failed'; reason: DisputeSeriesUnavailable };

const revisionKey = (attemptId: string, revision: number) => `${attemptId}:${revision}`;
const readyKey = (attemptId: string, revision: number) =>
  `dispute-series:ready:${revisionKey(attemptId, revision)}`;
const failedKey = (attemptId: string, revision: number) =>
  `dispute-series:failed:${revisionKey(attemptId, revision)}`;
const pendingKey = (attemptId: string, revision: number) =>
  `dispute-series:pending:${revisionKey(attemptId, revision)}`;
const viewedKey = (staffId: string, disputeId: string) =>
  `dispute-series:viewed:${staffId}:${disputeId}`;

const FailedReason = z.enum(['no_source', 'failed']);

/**
 * Кэш рядов пульса и мощности (race-results-06b): единственное место, где биометрия лежит вне потока разбора, — Redis с
 * TTL (`DISPUTE_SERIES_POLICY`), не MongoDB. Ключ — (попытка, ревизия проверки): перепроверка даёт новую ревизию, старые
 * ряды больше не читаются и истекают сами. Ключи — только id.
 */
@Injectable()
export class DisputeSeriesCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Готовые ряды или отказ; ничего — `null`. Повреждённая запись кэша считается отсутствующей. */
  async read(attemptId: string, revision: number): Promise<CachedSeries | null> {
    const [ready, failed] = await this.redis.mget(
      readyKey(attemptId, revision),
      failedKey(attemptId, revision),
    );
    if (ready) {
      const series = PanelDisputeSeriesData.safeParse(safeJson(ready));
      if (series.success) return { kind: 'ready', series: series.data };
    }
    const reason = FailedReason.safeParse(failed);
    return reason.success ? { kind: 'failed', reason: reason.data } : null;
  }

  /** Постановка задачи — одна на (попытка, ревизия), пока ключ жив; `false` — уже поставлена. */
  async claim(attemptId: string, revision: number): Promise<boolean> {
    const result = await this.redis.set(
      pendingKey(attemptId, revision),
      '1',
      'EX',
      DISPUTE_SERIES_POLICY.pendingTtlSec,
      'NX',
    );
    return result === 'OK';
  }

  async release(attemptId: string, revision: number): Promise<void> {
    await this.redis.del(pendingKey(attemptId, revision));
  }

  async storeReady(
    attemptId: string,
    revision: number,
    series: PanelDisputeSeriesData,
  ): Promise<void> {
    await this.redis
      .multi()
      .set(
        readyKey(attemptId, revision),
        JSON.stringify(series),
        'EX',
        DISPUTE_SERIES_POLICY.readyTtlSec,
      )
      .del(failedKey(attemptId, revision), pendingKey(attemptId, revision))
      .exec();
  }

  async storeFailed(
    attemptId: string,
    revision: number,
    reason: z.infer<typeof FailedReason>,
  ): Promise<void> {
    await this.redis
      .multi()
      .set(failedKey(attemptId, revision), reason, 'EX', DISPUTE_SERIES_POLICY.failedTtlSec)
      .del(pendingKey(attemptId, revision))
      .exec();
  }

  /** Первый просмотр рядов спора сотрудником за `viewedTtlSec` — `true` (писать журнал). */
  async markViewed(staffId: string, disputeId: string): Promise<boolean> {
    const result = await this.redis.set(
      viewedKey(staffId, disputeId),
      '1',
      'EX',
      DISPUTE_SERIES_POLICY.viewedTtlSec,
      'NX',
    );
    return result === 'OK';
  }

  /** Снять отметку просмотра (журнал не записался — следующий запрос запишет). */
  async unmarkViewed(staffId: string, disputeId: string): Promise<void> {
    await this.redis.del(viewedKey(staffId, disputeId));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
