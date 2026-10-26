import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { RouteFailureCode } from '@pokatim/contracts';
import type { RouteAnalysis } from '@pokatim/tracks/parse';
import { CLOCK, type Clock, type OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader, MongoTransactions } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { type ParseLimits, runParseThread, type ThreadOutcome } from '../../parse-thread';
import { QUEUE } from '../../queues';
import { ROUTE_RECEIVED, RouteReceived } from './routes.events';
import { ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';

export type RouteProcessingOutcome = 'ready' | 'failed' | 'skipped';

/**
 * Разбор маршрута (`route-processing`, jobId = id события outbox): захват по статусу `processing` (терминальный —
 * no-op) → исходник из `route_sources` → `analyzeRoute` в потоке с лимитами → отказ `failed: <код>` или транзакция
 * { геометрия + `processing → ready` }. Сбой окружения — исключение и ретрай BullMQ; последняя попытка —
 * `failed: unreadable` (панель показывает причину, маршрут не висит в «Обрабатываем…»). Параллелизм — 1.
 */
@Processor(QUEUE.routeProcessing, { concurrency: 1 })
export class RouteProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteProcessingProcessor.name);
  /** Лимиты потока разбора (тест «долгий разбор» уменьшает таймаут). */
  parseLimits: ParseLimits = ROUTE_POLICY.parseLimits;

  constructor(
    private readonly repository: RoutesRepository,
    private readonly outbox: MongoOutboxReader,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<RouteProcessingOutcome> {
    if (job.name !== ROUTE_RECEIVED) {
      throw new Error(`unknown job ${job.name} in queue ${QUEUE.routeProcessing}`);
    }
    const payload = RouteReceived.safeParse(await this.outbox.payloadOf(job.data.outboxEventId));
    if (!payload.success) {
      this.logger.warn(`event ${job.data.outboxEventId}: no valid payload, skipped`);
      return 'skipped';
    }
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return this.processRoute(payload.data.routeId, { finalAttempt });
  }

  /** Разбор в потоке с лимитами (точка подмены в тестах сбоя потока). */
  analyze(bytes: Uint8Array): Promise<ThreadOutcome<RouteAnalysis>> {
    return runParseThread<RouteAnalysis>('analyzeRoute', [bytes], this.parseLimits);
  }

  /** Обработка одного маршрута (вызывается и тестами напрямую). */
  async processRoute(
    routeId: string,
    { finalAttempt = false }: { finalAttempt?: boolean } = {},
  ): Promise<RouteProcessingOutcome> {
    const route = await this.repository.claim(routeId, this.clock.now());
    if (!route) return 'skipped';
    let outcome: ThreadOutcome<RouteAnalysis>;
    try {
      const bytes = await this.repository.sourceBytes(route._id);
      if (!bytes) throw new Error(`route ${route._id}: source is missing`);
      outcome = await this.analyze(bytes);
    } catch (error) {
      if (!finalAttempt) throw error;
      await this.repository.markFailed(route._id, 'unreadable', this.clock.now());
      this.logger.warn(`route ${route._id} failed on final attempt: parser error`);
      return 'failed';
    }
    if (!outcome.ok) {
      const failure = outcome.code as RouteFailureCode;
      await this.repository.markFailed(route._id, failure, this.clock.now());
      this.logger.log(`route ${route._id} failed: ${failure}`);
      return 'failed';
    }
    const analysis = outcome.result;
    const now = this.clock.now();
    const recorded = await this.transactions.run((tx) =>
      this.repository.markReady(
        tx,
        route._id,
        {
          distanceM: analysis.distanceM,
          elevationGainM: analysis.elevationGainM,
          isLoop: analysis.isLoop,
          start: analysis.start,
          finish: analysis.finish,
        },
        {
          line: { type: 'LineString', coordinates: analysis.line },
          matchLine: analysis.matchLine,
          sourcePointCount: analysis.sourcePointCount,
        },
        now,
      ),
    );
    if (!recorded) return 'skipped';
    this.logger.log(`route ${route._id} ready`);
    return 'ready';
  }
}
