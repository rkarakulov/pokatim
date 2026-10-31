import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../common.ts';
import {
  ROUTE_RIDE_CANDIDATES_MAX,
  ROUTE_RIDE_LEADERBOARD_DEFAULT,
  ROUTE_RIDE_LEADERBOARD_MAX,
  ROUTE_RIDE_MAX_PER_ROUTE,
  ROUTE_RIDE_ORIGINS,
  ROUTE_RIDE_STATUSES,
  RouteRideCandidates,
  RouteRideDetail,
  RouteRideLeaderboard,
  RouteRideLeaderboardQuery,
  RouteRidePage,
  RouteRideRequest,
  RouteRideTrack,
} from './route-ride.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-27T10:00:00.000Z';

const activity = { startedAt: AT, source: 'upload', elapsedSec: 900, distanceM: 8000 };
const route = { id: ID, title: 'Эталонный коридор', distanceM: 8000 };
const row = {
  id: ID,
  status: 'passed',
  reason: null,
  elapsedSec: 790,
  isBest: true,
  activity,
  createdAt: AT,
};
const detail = {
  id: ID,
  route,
  status: 'not_passed',
  reason: 'off_corridor',
  failure: null,
  elapsedSec: null,
  routeDistanceM: null,
  activity,
  comparison: {
    best: { id: ID, elapsedSec: 790, rideStartedAt: AT },
    isBest: false,
    deltaToBestSec: null,
    previous: null,
    deltaToPreviousSec: null,
  },
  createdAt: AT,
  checkedAt: AT,
};
const candidate = {
  activityId: ID,
  startedAt: AT,
  source: 'garmin',
  elapsedSec: 900,
  distanceM: 8000,
  rideId: null,
};
const track = {
  rideId: ID,
  line: [
    [27.5, 53.9],
    [27.6, 53.95],
  ],
  segment: { from: 0, to: 1 },
  offRuns: [],
  marks: 'ready',
};

describe('заезд по маршруту (route-rides-01): контракты', () => {
  it('статусы — в порядке ТЗ (только в конец)', () => {
    expect(ROUTE_RIDE_STATUSES).toEqual(['queued', 'checking', 'passed', 'not_passed', 'failed']);
    expect(ROUTE_RIDE_MAX_PER_ROUTE).toBe(100);
    expect(ROUTE_RIDE_CANDIDATES_MAX).toBe(30);
  });

  it('ответы — tolerantEnum: незнакомые статус, причина, провал, источник и разметка → unknown', () => {
    const parsed = RouteRideDetail.parse({
      ...detail,
      status: 'future',
      reason: 'new_reason',
      failure: 'new_failure',
      activity: { ...activity, source: 'strava' },
    });
    expect(parsed.status).toBe('unknown');
    expect(parsed.reason).toBe('unknown');
    expect(parsed.failure).toBe('unknown');
    expect(parsed.activity.source).toBe('unknown');
    expect(
      RouteRidePage.parse({
        route,
        summary: { count: 1, passedCount: 0, best: null },
        items: [{ ...row, status: 'future', reason: 'x' }],
      }).items[0],
    ).toMatchObject({ status: 'unknown', reason: 'unknown' });
    expect(RouteRideTrack.parse({ ...track, marks: 'future' }).marks).toBe('unknown');
    expect(
      RouteRideCandidates.parse({ items: [{ ...candidate, source: 'x' }] }).items[0]?.source,
    ).toBe('unknown');
  });

  it('деталь (route-rides-03): activityId и origin — аддитивно, старый ответ → null/manual', () => {
    expect(ROUTE_RIDE_ORIGINS).toEqual(['manual', 'auto']);
    const old = RouteRideDetail.parse(detail);
    expect(old.activityId).toBeNull();
    expect(old.origin).toBe('manual');
    const fresh = RouteRideDetail.parse({ ...detail, activityId: ID, origin: 'auto' });
    expect(fresh.activityId).toBe(ID);
    expect(fresh.origin).toBe('auto');
    expect(RouteRideDetail.parse({ ...detail, origin: 'x' }).origin).toBe('unknown');
    expect(RouteRideDetail.safeParse({ ...detail, activityId: 'nope' }).success).toBe(false);
  });

  it('запрос — ровно одно поле: activityId или uploadId (UUID)', () => {
    expect(RouteRideRequest.parse({ activityId: ID })).toEqual({ activityId: ID });
    expect(RouteRideRequest.parse({ uploadId: ID })).toEqual({ uploadId: ID });
    for (const bad of [
      {},
      { activityId: ID, uploadId: ID },
      { activityId: ID, extra: 1 },
      { activityId: 'not-a-uuid' },
      { uploadId: 42 },
      null,
    ]) {
      expect(RouteRideRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('пределы массивов: строки ≤ 100, кандидаты ≤ 30, линия 2–1000, offRuns ≤ 100', () => {
    const page = (n: number) => ({
      route,
      summary: { count: n, passedCount: 0, best: null },
      items: Array.from({ length: n }, () => row),
    });
    expect(RouteRidePage.safeParse(page(100)).success).toBe(true);
    expect(RouteRidePage.safeParse(page(101)).success).toBe(false);
    const candidates = (n: number) => ({ items: Array.from({ length: n }, () => candidate) });
    expect(RouteRideCandidates.safeParse(candidates(30)).success).toBe(true);
    expect(RouteRideCandidates.safeParse(candidates(31)).success).toBe(false);
    const line = (n: number) => Array.from({ length: n }, (_, i) => [27.5 + i * 1e-5, 53.9]);
    expect(RouteRideTrack.safeParse({ ...track, line: line(1) }).success).toBe(false);
    expect(RouteRideTrack.safeParse({ ...track, line: line(1000) }).success).toBe(true);
    expect(RouteRideTrack.safeParse({ ...track, line: line(1001) }).success).toBe(false);
    const runs = (n: number) => Array.from({ length: n }, () => ({ from: 0, to: 1 }));
    expect(RouteRideTrack.safeParse({ ...track, offRuns: runs(100) }).success).toBe(true);
    expect(RouteRideTrack.safeParse({ ...track, offRuns: runs(101) }).success).toBe(false);
  });

  it('деталь: знаковые целые дельты (отрицательная — быстрее), даты ISO', () => {
    const parsed = RouteRideDetail.parse({
      ...detail,
      status: 'passed',
      reason: null,
      elapsedSec: 780,
      routeDistanceM: 8010,
      comparison: { ...detail.comparison, deltaToBestSec: -10, deltaToPreviousSec: 5 },
    });
    expect(parsed.comparison.deltaToBestSec).toBe(-10);
    expect(RouteRideDetail.safeParse({ ...detail, createdAt: 'вчера' }).success).toBe(false);
    expect(
      RouteRideDetail.safeParse({
        ...detail,
        comparison: { ...detail.comparison, deltaToBestSec: 1.5 },
      }).success,
    ).toBe(false);
  });

  it('коды ошибок route-rides — подряд, после кодов story-cards (дальше — только новые)', () => {
    const codes = ErrorCode.options;
    const start = codes.indexOf('ROUTE_RIDE_NOT_READY');
    expect(start).toBeGreaterThan(codes.indexOf('STORY_CARD_UNAVAILABLE'));
    expect(codes.slice(start, start + 3)).toEqual([
      'ROUTE_RIDE_NOT_READY',
      'ROUTE_RIDE_UPLOAD_FAILED',
      'ROUTE_RIDE_QUOTA_EXCEEDED',
    ]);
  });
});

describe('таблица «Другие» (route-rides-04): контракты', () => {
  const leaderRow = { place: 1, elapsedSec: 780, rideDate: '2026-10-27' };

  it('query: по умолчанию 10, строка приводится, 1–100 целые, лишний ключ — ошибка', () => {
    expect(ROUTE_RIDE_LEADERBOARD_DEFAULT).toBe(10);
    expect(ROUTE_RIDE_LEADERBOARD_MAX).toBe(100);
    expect(RouteRideLeaderboardQuery.parse({})).toEqual({ limit: 10 });
    expect(RouteRideLeaderboardQuery.parse({ limit: '5' })).toEqual({ limit: 5 });
    expect(RouteRideLeaderboardQuery.parse({ limit: '100' })).toEqual({ limit: 100 });
    for (const limit of ['0', '101', '1.5', 'abc']) {
      expect(RouteRideLeaderboardQuery.safeParse({ limit }).success).toBe(false);
    }
    expect(RouteRideLeaderboardQuery.safeParse({ limit: '5', cursor: 'x' }).success).toBe(false);
  });

  it('строка без имени, ссылки, фото и rideId — null; своя — с rideId', () => {
    const parsed = RouteRideLeaderboard.parse({
      rows: [leaderRow, { ...leaderRow, place: 2, rideId: ID }],
      total: 2,
      me: { place: 2, elapsedSec: 780, rideDate: '2026-10-27', rideId: ID },
      shared: false,
    });
    expect(parsed.rows[0]).toEqual({
      ...leaderRow,
      riderName: null,
      riderPublicId: null,
      riderAvatar: null,
      rideId: null,
    });
    expect(parsed.rows[1]?.rideId).toBe(ID);
    expect(RouteRideLeaderboard.parse({ rows: [], total: 0, me: null, shared: true }).me).toBe(
      null,
    );
  });

  it('дата заезда — только день (с временем суток — ошибка); строк > 100 — ошибка', () => {
    const table = (rows: unknown[]) => ({ rows, total: rows.length, me: null, shared: true });
    expect(RouteRideLeaderboard.safeParse(table([{ ...leaderRow, rideDate: AT }])).success).toBe(
      false,
    );
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...leaderRow, place: i + 1 }));
    expect(RouteRideLeaderboard.safeParse(table(many(100))).success).toBe(true);
    expect(RouteRideLeaderboard.safeParse(table(many(101))).success).toBe(false);
  });
});
