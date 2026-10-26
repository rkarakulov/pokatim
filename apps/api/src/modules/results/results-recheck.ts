import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';

import { AttemptIntake } from './attempt-intake';
import type { RaceAttemptDoc } from './results.collection';
import { RESULTS_POLICY } from './results.policy';
import { ResultsRepository } from './results.repository';

/**
 * Перепроверка попыток (race-results-03): механизм для слайса 05 («перепроверить гонку» после смены версии движка —
 * запуск и журнал пересчётов там) и регламент зависших проверок. Каждая попытка — своя транзакция под `lockEntry`:
 * новая `checkRevision`, `queued`, событие проверки; лучшие результаты пересчитываются по мере вердиктов.
 */
@Injectable()
export class ResultsRecheck {
  private readonly logger = new Logger(ResultsRecheck.name);

  constructor(
    private readonly repository: ResultsRepository,
    private readonly intake: AttemptIntake,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Все попытки гонки, кроме снятых, — на новую проверку; число поставленных. */
  async requestRace(raceId: string): Promise<number> {
    let queued = 0;
    for (const { _id, entryId } of await this.repository.liveAttemptsOfRace(raceId)) {
      const requeued = await this.transactions.run(async (tx) => {
        const now = this.clock.now();
        const entry = await this.repository.lockEntry(tx, entryId, now);
        if (!entry) return false;
        const attempt = await this.repository.requeueAttempt(tx, _id, now, {
          statusIn: ['queued', 'checking', 'counted', 'rejected', 'failed'],
        });
        if (!attempt) return false;
        await this.intake.queueCheck(tx, attempt);
        await this.repository.refreshEntry(tx, entry);
        return true;
      });
      if (requeued) queued += 1;
    }
    this.logger.log(`race ${raceId}: recheck requested for ${queued} attempts`);
    return queued;
  }

  /**
   * Зависшие проверки (`results-maintenance`): `checking` дольше 15 мин или `queued` дольше 2 ч — новая ревизия и
   * событие; после `maxRequeues` перепостановок — `failed: error` (видно в панели). `queued`, задача которой ещё
   * ждёт в очереди (`jobPending` по `checkJobId` — долгий хвост очереди последнего вечера окна), не трогается.
   */
  async requeueStuck({
    jobPending = () => Promise.resolve(false),
  }: { jobPending?: (jobId: string) => Promise<boolean> } = {}): Promise<{
    requeued: number;
    failed: number;
  }> {
    const now = this.clock.now().getTime();
    const checkingBefore = new Date(now - RESULTS_POLICY.stuckCheckingMs);
    const queuedBefore = new Date(now - RESULTS_POLICY.stuckQueuedMs);
    let requeued = 0;
    let failed = 0;
    // обход продолжается за пропущенными (живые задачи): пакет ограничен обработанными, обход — числом пакетов
    let after: { updatedAt: Date; id: string } | null = null;
    for (let scanned = 0; scanned < RESULTS_POLICY.stuckScanBatches; scanned += 1) {
      const batch = await this.repository.stuckAttempts(
        checkingBefore,
        queuedBefore,
        after,
        RESULTS_POLICY.stuckBatchSize,
      );
      for (const candidate of batch) {
        after = { updatedAt: candidate.updatedAt, id: candidate._id };
        const outcome = await this.handleStuck(candidate, checkingBefore, queuedBefore, jobPending);
        if (outcome === 'requeued') requeued += 1;
        if (outcome === 'failed') failed += 1;
        if (requeued + failed >= RESULTS_POLICY.stuckBatchSize) break;
      }
      if (batch.length < RESULTS_POLICY.stuckBatchSize) break;
      if (requeued + failed >= RESULTS_POLICY.stuckBatchSize) break;
    }
    this.logger.log(`stuck checks: ${requeued} requeued, ${failed} failed`);
    return { requeued, failed };
  }

  /** Одна зависшая проверка: живая задача — пропуск; иначе новая ревизия или `failed: error` под `lockEntry`. */
  private async handleStuck(
    candidate: RaceAttemptDoc,
    checkingBefore: Date,
    queuedBefore: Date,
    jobPending: (jobId: string) => Promise<boolean>,
  ): Promise<'requeued' | 'failed' | null> {
    if (
      candidate.status === 'queued' &&
      candidate.checkJobId !== null &&
      (await jobPending(candidate.checkJobId))
    ) {
      return null;
    }
    return this.transactions.run(async (tx) => {
      const at = this.clock.now();
      const entry = await this.repository.lockEntry(tx, candidate.entryId, at);
      const attempt = await this.repository.findAttempt(candidate._id, tx);
      if (!entry || !attempt) return null;
      const stillStuck =
        (attempt.status === 'checking' && attempt.updatedAt < checkingBefore) ||
        (attempt.status === 'queued' && attempt.updatedAt < queuedBefore);
      if (!stillStuck || attempt.checkRevision !== candidate.checkRevision) return null;
      if (attempt.requeues >= RESULTS_POLICY.maxRequeues) {
        await this.repository.failAttempt(tx, attempt._id, attempt.checkRevision, 'error', at);
        await this.repository.refreshEntry(tx, entry);
        return 'failed' as const;
      }
      const next = await this.repository.requeueAttempt(tx, attempt._id, at, {
        statusIn: ['queued', 'checking'],
        requeue: true,
      });
      if (!next) return null;
      await this.intake.queueCheck(tx, next);
      await this.repository.refreshEntry(tx, entry);
      return 'requeued' as const;
    });
  }
}
