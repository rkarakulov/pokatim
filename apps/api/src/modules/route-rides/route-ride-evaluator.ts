import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AttemptFailure } from '@pokatim/contracts';
import {
  type AttemptAnalysis,
  type CorridorGeometry,
  type MatchWindow,
  ROUTE_SECTION_POLICY,
  ROUTE_SECTIONS_VERSION,
  type RouteSectionsAnalysis,
  type TrackFormat,
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
import type { RouteRideDoc, RouteRideResult, RouteRideSectionsDoc } from './route-rides.collection';
import { matchWindowOf, verdictOf } from './route-rides.policy';

/** Коды потока, которые становятся провалом проверки без ретрая (повтор даст то же). */
const THREAD_FAILURES: readonly string[] = ['timeout', 'unreadable', 'corridor_invalid'];

/** Код отказа потока → провал (`THREAD_FAILURES`; иное — `unreadable`). Общий для сверки маршрута и участков. */
const threadFailureOf = (code: string): AttemptFailure =>
  THREAD_FAILURES.includes(code) ? (code as AttemptFailure) : 'unreadable';

/**
 * Когда считать участки (route-rides-05, RC-9): ручная проверка — `always` (при любом итоге движка), автопроверка —
 * `ifPassed` (только «Пройден»; иначе заезда нет — второго потока тоже).
 */
export type SectionsMode = 'always' | 'ifPassed';

const emptyResult = (now: Date): RouteRideResult => ({
  status: 'failed',
  reasons: [],
  failure: null,
  segment: null,
  touchedCorridor: null,
  engineVersion: null,
  trackMap: null,
  checkedAt: now,
  sections: null,
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
 * → итог без записи. Сбой окружения (загрузчик потока, БД, хранилище не ENOENT) — исключение. Участки (route-rides-05)
 * — вторым вызовом потока `analyzeSections` после итога движка (режим `SectionsMode`): их таймаут и сбой не ломают
 * вердикт маршрута.
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

  /** Сверка участков в потоке разбора (точка подмены в тестах). */
  analyzeSections(
    bytes: Uint8Array,
    format: TrackFormat,
    corridor: CorridorGeometry,
    window: MatchWindow,
    now: Date,
  ): Promise<ThreadOutcome<RouteSectionsAnalysis>> {
    return runParseThread<RouteSectionsAnalysis>(
      'analyzeSections',
      [bytes, format, corridor, window, now],
      this.parseLimits,
    );
  }

  async evaluate(
    ride: RouteRideToEvaluate,
    { sections }: { sections: SectionsMode },
  ): Promise<RouteRideResult> {
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
    const corridor = { ...geometry, widthM: ride.corridorWidthM };
    const window = matchWindowOf(ride.activity);
    const outcome = await this.analyze(source.bytes, source.format, corridor, window, now, line);
    if (!outcome.ok) {
      // RC-9: без итога движка участков нет (файл тот же — повтор даст то же)
      if (outcome.code === 'implausible') {
        return { ...emptyResult(now), status: 'not_passed', reasons: ['implausible'] };
      }
      return failedResult(threadFailureOf(outcome.code), now);
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
    const verdict = verdictOf(match);
    const withSections = sections === 'always' || verdict.status === 'passed';
    return {
      ...emptyResult(now),
      ...verdict,
      segment,
      touchedCorridor: match.touchedCorridor,
      engineVersion: match.engineVersion,
      trackMap: match.trackMap,
      sections: withSections ? await this.sectionsOf(ride, source, corridor, window, now) : null,
    };
  }

  /**
   * Участки заезда (RC-8…RC-10): маршрут короче `minRouteM` (`distanceM` ≥ длины линии сверки) — пусто без потока
   * (семафор не держится); иначе `analyzeSections`. Отказ потока — `failure` тем же маппингом, сбой окружения
   * (исключение) — `error` без ретрая: вердикт маршрута уже получен.
   */
  private async sectionsOf(
    ride: RouteRideToEvaluate,
    source: { bytes: Uint8Array; format: TrackFormat },
    corridor: CorridorGeometry,
    window: MatchWindow,
    now: Date,
  ): Promise<RouteRideSectionsDoc> {
    if (corridor.distanceM < ROUTE_SECTION_POLICY.minRouteM) {
      return { version: ROUTE_SECTIONS_VERSION, failure: null, items: [] };
    }
    const started = Date.now();
    let result: RouteRideSectionsDoc;
    try {
      const outcome = await this.analyzeSections(
        source.bytes,
        source.format,
        corridor,
        window,
        now,
      );
      result = outcome.ok
        ? {
            version: outcome.result.version,
            failure: null,
            items: outcome.result.items.map((item) => ({
              fromM: item.fromM,
              toM: item.toM,
              status: item.verdict === 'counted' ? 'passed' : 'not_passed',
              elapsedSec: item.verdict === 'counted' ? item.elapsedSec : null,
            })),
          }
        : { version: ROUTE_SECTIONS_VERSION, failure: threadFailureOf(outcome.code), items: [] };
    } catch (error) {
      this.logger.warn(
        `route-ride ${ride._id} sections: environment failure` +
          ` (${error instanceof Error ? error.name : 'unknown'})`,
      );
      result = { version: ROUTE_SECTIONS_VERSION, failure: 'error', items: [] };
    }
    const passed = result.items.filter((item) => item.status === 'passed').length;
    this.logger.log(
      `route-ride ${ride._id} sections: ${result.items.length} items, ${passed} passed` +
        `${result.failure ? `, failure ${result.failure}` : ''} in ${Date.now() - started} ms`,
    );
    return result;
  }
}
