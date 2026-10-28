import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { AttemptFailure } from '@pokatim/contracts';
import type {
  AttemptAnalysis,
  CorridorGeometry,
  MatchWindow,
  TrackFormat,
} from '@pokatim/tracks/parse';
import { CLOCK, type Clock, type OutboxJobData } from '@rkarakulov/api-kit/core';
import { MongoOutboxReader } from '@rkarakulov/api-kit/mongo';
import type { Job } from 'bullmq';

import {
  DEFAULT_PARSE_LIMITS,
  type ParseLimits,
  runParseThread,
  type ThreadOutcome,
} from '../../parse-thread';
import { QUEUE } from '../../queues';
import { ROUTE_RIDE_ROUTES, type RouteRideRoutes } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import type { RouteRideDoc } from './route-rides.collection';
import { ROUTE_RIDES_CHECK_REQUESTED, RouteRidesCheckRequested } from './route-rides.events';
import { matchWindowOf, verdictOf } from './route-rides.policy';
import { type RouteRideResult, RouteRidesRepository } from './route-rides.repository';

export type RouteRideCheckOutcome = 'passed' | 'not_passed' | 'failed' | 'skipped';

/** Коды потока, которые становятся провалом проверки без ретрая (повтор даст то же). */
const THREAD_FAILURES: readonly string[] = ['timeout', 'unreadable', 'corridor_invalid'];

const emptyResult = (now: Date): RouteRideResult => ({
  status: 'failed',
  reasons: [],
  failure: null,
  segment: null,
  touchedCorridor: null,
  engineVersion: null,
  trackMap: null,
  checkedAt: now,
});

const failed = (failure: AttemptFailure, now: Date): RouteRideResult => ({
  ...emptyResult(now),
  failure,
});

/**
 * Сверка заезда по маршруту (`route-ride-check`, jobId = id события outbox `route-rides.check-requested`): захват своей
 * ревизии → линия сверки маршрута, видимого райдеру сейчас (порт `RouteRideRoutes`, 8.1 RC-9), исходник и линия показа
 * активности (порт `ActivitySource`) → `analyzeAttempt` в потоке разбора (семафор, лимиты — как у гонок) с окном
 * «время заезда ± 1 мин» → одна запись итога своей ревизией, без транзакции и событий. Сбой окружения — исключение и
 * ретрай BullMQ, на последней попытке — `failed: error`. Небольшая копия оркестрации `AttemptCheckProcessor` (5.1):
 * гоночная связана с заявкой, датчиками и событием вердикта. Параллелизм — 1.
 */
@Processor(QUEUE.routeRideCheck, { concurrency: 1 })
export class RouteRideCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(RouteRideCheckProcessor.name);
  /** Лимиты потока разбора (тест «долгая проверка» уменьшает таймаут). */
  parseLimits: ParseLimits = DEFAULT_PARSE_LIMITS;

  constructor(
    private readonly repository: RouteRidesRepository,
    private readonly outbox: MongoOutboxReader,
    @Inject(ROUTE_RIDE_ROUTES) private readonly routes: RouteRideRoutes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
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

  /** Сверка в потоке разбора (точка подмены в тестах сбоя потока). */
  analyze(
    bytes: Uint8Array,
    format: TrackFormat,
    corridor: CorridorGeometry,
    window: MatchWindow,
    now: Date,
    line: [number, number][] | null = null,
  ): Promise<ThreadOutcome<AttemptAnalysis>> {
    return runParseThread<AttemptAnalysis>(
      'analyzeAttempt',
      [bytes, format, corridor, window, now, line],
      this.parseLimits,
    );
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
      result = await this.evaluate(ride);
    } catch (error) {
      // сбой окружения (загрузчик потока, БД, хранилище не ENOENT) — ретрай; на последней попытке — видимый провал
      if (!finalAttempt) throw error;
      result = failed('error', this.clock.now());
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

  private async evaluate(ride: RouteRideDoc): Promise<RouteRideResult> {
    const geometry = await this.routes.matchGeometry(ride.routeId, ride.userId);
    if (!geometry) {
      this.logger.warn(`route-ride ${ride._id}: route_unavailable`);
      return failed('corridor_invalid', this.clock.now());
    }
    const source = await this.activities.readSource(ride.activityId);
    if (!source) return failed('storage', this.clock.now());
    // сохранённая линия показа — разметка трека считается по ней (maps-02)
    const line = await this.activities.trackLine(ride.userId, ride.activityId);
    const now = this.clock.now();
    const outcome = await this.analyze(
      source.bytes,
      source.format,
      { ...geometry, widthM: ride.corridorWidthM },
      matchWindowOf(ride.activity),
      now,
      line,
    );
    if (!outcome.ok) {
      if (outcome.code === 'implausible') {
        return { ...emptyResult(now), status: 'not_passed', reasons: ['implausible'] };
      }
      const failure = THREAD_FAILURES.includes(outcome.code)
        ? (outcome.code as AttemptFailure)
        : 'unreadable';
      return failed(failure, now);
    }
    const match = outcome.result;
    const segment = match.segment
      ? {
          startedAt: match.segment.startedAt,
          finishedAt: match.segment.finishedAt,
          elapsedSec: match.segment.elapsedSec,
          distanceM: match.segment.distanceM,
          offCorridorM: match.segment.offCorridorM,
          offCorridorShare: match.segment.offCorridorShare,
          maxExcursionM: match.segment.maxExcursionM,
          coverage: match.segment.coverage,
        }
      : null;
    return {
      ...emptyResult(now),
      ...verdictOf(match),
      segment,
      touchedCorridor: match.touchedCorridor,
      engineVersion: match.engineVersion,
      trackMap: match.trackMap,
    };
  }
}
