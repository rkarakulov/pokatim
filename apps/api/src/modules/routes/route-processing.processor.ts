import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { RouteFailureCode } from '@pokatim/contracts';
import { ROUTE_DERIVED_VERSION, type RouteAnalysis } from '@pokatim/tracks/parse';
import { CLOCK, type Clock, type OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader, MongoTransactions } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import { type ParseLimits, runParseThread, type ThreadOutcome } from '../../parse-thread';
import { QUEUE } from '../../queues';
import { exportFilesOf } from './route-derived';
import { ROUTE_RECEIVED, RouteReceived } from './routes.events';
import { ROUTE_POLICY } from './routes.policy';
import { RoutesRepository } from './routes.repository';

export type RouteProcessingOutcome = 'ready' | 'failed' | 'skipped';

/**
 * Разбор маршрута (`route-processing`, jobId = id события outbox): захват по статусу `processing` (терминальный —
 * no-op) → исходник из `route_sources` → `analyzeRoute` в потоке с лимитами → отказ `failed: <код>` или транзакция
 * { геометрия, профиль высоты и экспорт GPX/KML/TCX (routes-03, routes-formats; сжат gzip до транзакции —
 * route-exports-gzip) + `processing → ready` }. Сбой окружения (исходник, поток, запись результата) — исключение и ретрай
 * BullMQ; последняя попытка — `failed: unreadable` (панель показывает причину, маршрут не висит в «Обрабатываем…»;
 * если и эта запись не удалась — повторная загрузка того же файла вернёт маршрут в обработку). Параллелизм — 1.
 * Маршрут райдера, удалённый автором во время обработки (routes-02), — `skipped`: захвата нет, исходника и маршрута
 * нет, `markReady` не находит документ (геометрия не пишется).
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
    try {
      return await this.analyzeAndRecord(route._id);
    } catch (error) {
      // сбой окружения (исходник, поток, запись результата) — ретрай; на последней попытке — видимый отказ
      if (!finalAttempt) throw error;
      await this.repository.markFailed(route._id, 'unreadable', this.clock.now());
      this.logger.warn(`route ${route._id} failed on final attempt: environment error`);
      return 'failed';
    }
  }

  private async analyzeAndRecord(routeId: string): Promise<RouteProcessingOutcome> {
    const bytes = await this.repository.sourceBytes(routeId);
    if (!bytes) {
      // маршрут райдера удалён автором после захвата (routes-02, RC-8) — no-op без ретрая
      if (!(await this.repository.findRoute(routeId))) {
        this.logger.log(`route ${routeId} deleted during processing`);
        return 'skipped';
      }
      throw new Error(`route ${routeId}: source is missing`);
    }
    const outcome = await this.analyze(bytes);
    if (!outcome.ok) {
      const failure = outcome.code as RouteFailureCode;
      await this.repository.markFailed(routeId, failure, this.clock.now());
      this.logger.log(`route ${routeId} failed: ${failure}`);
      return 'failed';
    }
    const analysis = outcome.result;
    // экспорт сжат gzip до транзакции (route-exports-gzip, RC-5)
    const files = await exportFilesOf(analysis);
    const now = this.clock.now();
    const recorded = await this.transactions.run((tx) =>
      this.repository.markReady(
        tx,
        routeId,
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
          profile: analysis.profile,
          derivedVersion: ROUTE_DERIVED_VERSION,
        },
        files,
        now,
      ),
    );
    if (!recorded) return 'skipped';
    this.logger.log(`route ${routeId} ready`);
    return 'ready';
  }
}
