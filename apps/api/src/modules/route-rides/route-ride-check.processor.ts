import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { CLOCK, type Clock, type OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { QUEUE } from '../../queues';
import { failedResult, RouteRideEvaluator } from './route-ride-evaluator';
import { ROUTE_RIDES_CHECK_REQUESTED, RouteRidesCheckRequested } from './route-rides.events';
import type { RouteRideResult } from './route-rides.collection';
import { RouteRidesRepository } from './route-rides.repository';

export type RouteRideCheckOutcome = 'passed' | 'not_passed' | 'failed' | 'skipped';

/**
 * Сверка заезда по маршруту (`route-ride-check`, jobId = id события outbox `route-rides.check-requested`): захват своей
 * ревизии → сверка `RouteRideEvaluator` (общая с автопроверкой, route-rides-03) → одна запись итога своей ревизией, без транзакции и событий. Сбой окружения — исключение и
 * ретрай BullMQ, на последней попытке — `failed: error`. Небольшая копия оркестрации `AttemptCheckProcessor` (5.1):
 * гоночная связана с заявкой, датчиками и событием вердикта. Параллелизм — 1.
 */
@Processor(QUEUE.routeRideCheck, { concurrency: 1 })
export class RouteRideCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteRideCheckProcessor.name);

  constructor(
    private readonly repository: RouteRidesRepository,
    private readonly outbox: MongoOutboxReader,
    private readonly evaluator: RouteRideEvaluator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<RouteRideCheckOutcome> {
    if (job.name !== ROUTE_RIDES_CHECK_REQUESTED) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.routeRideCheck}`);
    }
    const payload = RouteRidesCheckRequested.safeParse(
      await this.outbox.payloadOf(job.data.outboxEventId),
    );
    if (!payload.success) {
      this.logger.warn(`event ${job.data.outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return this.check(payload.data.rideId, payload.data.checkRevision, { finalAttempt });
  }

  /** Проверка одной ревизии заезда (вызывается и тестами напрямую). */
  async check(
    rideId: string,
    checkRevision: number,
    { finalAttempt = false }: { finalAttempt?: boolean } = {},
  ): Promise<RouteRideCheckOutcome> {
    const started = Date.now();
    const ride = await this.repository.claim(rideId, checkRevision, this.clock.now());
    if (!ride) return 'skipped';
    let result: RouteRideResult;
    try {
      result = await this.evaluator.evaluate(ride);
    } catch (error) {
      // сбой окружения (загрузчик потока, БД, хранилище не ENOENT) — ретрай; на последней попытке — видимый провал
      if (!finalAttempt) throw error;
      result = failedResult('error', this.clock.now());
    }
    const recorded = await this.repository.record(
      ride._id,
      ride.checkRevision,
      result,
      this.clock.now(),
    );
    const outcome: RouteRideCheckOutcome = recorded
      ? (result.status as Exclude<RouteRideCheckOutcome, 'skipped'>)
      : 'skipped';
    this.logger.log(
      `route-ride ${ride._id} rev ${checkRevision}: ${outcome}` +
        `${result.failure ? ` (${result.failure})` : ''}${result.reasons[0] ? ` (${result.reasons[0]})` : ''}` +
        ` in ${Date.now() - started} ms`,
    );
    return outcome;
  }
}
