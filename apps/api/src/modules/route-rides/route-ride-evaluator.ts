import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AttemptFailure } from '@pokatim/contracts';
import type {
  AttemptAnalysis,
  CorridorGeometry,
  MatchWindow,
  TrackFormat,
} from '@pokatim/tracks/parse';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import {
  DEFAULT_PARSE_LIMITS,
  type ParseLimits,
  runParseThread,
  type ThreadOutcome,
} from '../../parse-thread';
import { ROUTE_RIDE_ROUTES, type RouteRideRoutes } from '../routes';
import { ACTIVITY_SOURCE, type ActivitySource } from '../tracks';
import type { RouteRideDoc, RouteRideResult } from './route-rides.collection';
import { matchWindowOf, verdictOf } from './route-rides.policy';

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

/** Итог «провал проверки» с кодом (финальная попытка ручной проверки — `error`). */
export const failedResult = (failure: AttemptFailure, now: Date): RouteRideResult => ({
  ...emptyResult(now),
  failure,
});

/** Поля заезда, нужные сверке (у автопроверки документа ещё нет). */
export type RouteRideToEvaluate = Pick<
  RouteRideDoc,
  '_id' | 'userId' | 'routeId' | 'activityId' | 'activity' | 'corridorWidthM'
>;

/**
 * Сверка заезда с маршрутом (worker; общая для ручной проверки и автопроверки, route-rides-03): линия сверки маршрута,
 * видимого райдеру сейчас (порт `RouteRideRoutes`, 8.1 RC-9), исходник и линия показа активности (порт
 * `ActivitySource`) → `analyzeAttempt` в потоке разбора (семафор, лимиты — как у гонок) с окном «время заезда ± 1 мин»
 * → итог без записи. Сбой окружения (загрузчик потока, БД, хранилище не ENOENT) — исключение.
 */
@Injectable()
export class RouteRideEvaluator {
  private readonly logger = new Logger(RouteRideEvaluator.name);
  /** Лимиты потока разбора (тест «долгая проверка» уменьшает таймаут). */
  parseLimits: ParseLimits = DEFAULT_PARSE_LIMITS;

  constructor(
    @Inject(ROUTE_RIDE_ROUTES) private readonly routes: RouteRideRoutes,
    @Inject(ACTIVITY_SOURCE) private readonly activities: ActivitySource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

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

  async evaluate(ride: RouteRideToEvaluate): Promise<RouteRideResult> {
    const geometry = await this.routes.matchGeometry(ride.routeId, ride.userId);
    if (!geometry) {
      this.logger.warn(`route-ride ${ride._id}: route_unavailable`);
      return failedResult('corridor_invalid', this.clock.now());
    }
    const source = await this.activities.readSource(ride.activityId);
    if (!source) return failedResult('storage', this.clock.now());
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
      return failedResult(failure, now);
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
