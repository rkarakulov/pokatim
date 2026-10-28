import type { Bounds } from '@pokatim/tracks';
import { describe, expect, it } from 'vitest';

import type { ActivityRef } from '../tracks';
import type { RouteRideDoc } from './route-rides.collection';
import {
  bestOf,
  candidateRows,
  comparisonOf,
  effectiveStatus,
  findExisting,
  matchWindowOf,
  previousOf,
  ROUTE_RIDE_POLICY,
  sortRides,
  summaryOf,
  verdictOf,
} from './route-rides.policy';

const T0 = new Date('2026-10-20T06:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const MIN = 60_000;

let seq = 0;
const id = (n: number) => `01890a5d-ac96-774b-bcce-${String(n).padStart(12, '0')}`;

function ride(overrides: Partial<RouteRideDoc> & { elapsed?: number; day?: number } = {}) {
  const { elapsed, day = 0, ...rest } = overrides;
  seq += 1;
  const startedAt = new Date(T0.getTime() + day * 86_400_000);
  const doc: RouteRideDoc = {
    _id: id(seq),
    userId: id(900),
    routeId: id(901),
    activityId: id(1000 + seq),
    activity: {
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
      source: 'upload',
      elapsedSec: 3600,
      distanceM: 30_000,
    },
    corridorWidthM: 50,
    status: elapsed === undefined ? 'not_passed' : 'passed',
    checkRevision: 1,
    checkAttempts: 1,
    reasons: elapsed === undefined ? ['off_corridor'] : [],
    failure: null,
    segment:
      elapsed === undefined
        ? null
        : {
            startedAt,
            finishedAt: new Date(startedAt.getTime() + elapsed * 1000),
            elapsedSec: elapsed,
            distanceM: 8000,
            offCorridorM: 0,
            offCorridorShare: 0,
            maxExcursionM: 0,
            coverage: 1,
          },
    touchedCorridor: true,
    engineVersion: 1,
    trackMap: null,
    createdAt: T0,
    updatedAt: T0,
    checkedAt: T0,
    ...rest,
  };
  return doc;
}

describe('route-rides.policy', () => {
  it('политика: коридор 50 м, окно ±1 мин, кандидаты 365 д / 200 / 30, квота 100, лимит 30/ч', () => {
    expect(ROUTE_RIDE_POLICY).toMatchObject({
      corridorWidthM: 50,
      windowMarginMs: 60_000,
      candidatesDays: 365,
      candidatesScan: 200,
      candidatesLimit: 30,
      boundsMarginM: 600,
      maxPerRoute: 100,
      userLimit: { limit: 30, windowSec: 3600 },
    });
  });

  it('matchWindowOf — время самого заезда ± 1 мин', () => {
    expect(matchWindowOf({ startedAt: at(0), endedAt: at(60) })).toEqual({
      startsAt: at(-1),
      closesAt: at(61),
    });
  });

  it('effectiveStatus — зависшие queued > 2 ч и checking > 15 мин по updatedAt → failed: error (граница строго больше)', () => {
    const updatedAt = at(0);
    const check = (status: RouteRideDoc['status'], ms: number) =>
      effectiveStatus({ status, failure: null, updatedAt }, new Date(updatedAt.getTime() + ms));
    expect(check('queued', 2 * 60 * MIN)).toEqual({ status: 'queued', failure: null });
    expect(check('queued', 2 * 60 * MIN + 1)).toEqual({ status: 'failed', failure: 'error' });
    expect(check('checking', 15 * MIN)).toEqual({ status: 'checking', failure: null });
    expect(check('checking', 15 * MIN + 1)).toEqual({ status: 'failed', failure: 'error' });
    expect(check('passed', 100 * 60 * MIN)).toEqual({ status: 'passed', failure: null });
    expect(effectiveStatus({ status: 'failed', failure: 'timeout', updatedAt }, at(500))).toEqual({
      status: 'failed',
      failure: 'timeout',
    });
  });

  it('verdictOf — counted → passed без причин, rejected → not_passed с причинами', () => {
    expect(verdictOf({ verdict: 'counted', reasons: [] })).toEqual({
      status: 'passed',
      reasons: [],
    });
    expect(verdictOf({ verdict: 'rejected', reasons: ['no_finish', 'off_corridor'] })).toEqual({
      status: 'not_passed',
      reasons: ['no_finish', 'off_corridor'],
    });
  });

  it('bestOf — минимум времени среди passed; ничья — раньше заезд, затем меньший _id; без passed — null', () => {
    const slow = ride({ elapsed: 900, day: 0 });
    const fastLate = ride({ elapsed: 800, day: 5 });
    const fastEarly = ride({ elapsed: 800, day: 2 });
    const failed = ride({ day: 1 });
    expect(bestOf([slow, fastLate, failed, fastEarly])?._id).toBe(fastEarly._id);
    const twinA = ride({ elapsed: 700, day: 3 });
    const twinB = { ...ride({ elapsed: 700, day: 3 }), _id: id(1) };
    expect(bestOf([twinA, twinB])?._id).toBe(id(1));
    expect(bestOf([failed])).toBeNull();
    expect(bestOf([])).toBeNull();
  });

  it('previousOf — последний passed строго раньше по дате заезда; ничья по времени — меньший _id', () => {
    const first = ride({ elapsed: 900, day: 0 });
    const notPassed = ride({ day: 2 });
    const second = ride({ elapsed: 850, day: 3 });
    const current = ride({ elapsed: 800, day: 5 });
    const rides = [first, notPassed, second, current];
    expect(previousOf(rides, current)?._id).toBe(second._id);
    expect(previousOf(rides, second)?._id).toBe(first._id);
    expect(previousOf(rides, first)).toBeNull();
    // одинаковое время заезда — не «раньше»
    const sameTime = ride({ elapsed: 700, day: 5 });
    expect(previousOf([...rides, sameTime], current)?._id).toBe(second._id);
    const twinA = ride({ elapsed: 700, day: 4 });
    const twinB = { ...ride({ elapsed: 710, day: 4 }), _id: id(2) };
    expect(previousOf([twinA, twinB, current], current)?._id).toBe(id(2));
  });

  it('comparisonOf — дельты только у passed; у лучшего 0 и isBest; not_passed — best есть, дельт нет', () => {
    const first = ride({ elapsed: 900, day: 0 });
    const best = ride({ elapsed: 800, day: 2 });
    const current = ride({ elapsed: 850, day: 5 });
    const rejected = ride({ day: 6 });
    const rides = [first, best, current, rejected];
    expect(comparisonOf(rides, current)).toEqual({
      best: { id: best._id, elapsedSec: 800, rideStartedAt: best.activity.startedAt.toISOString() },
      isBest: false,
      deltaToBestSec: 50,
      previous: {
        id: best._id,
        elapsedSec: 800,
        rideStartedAt: best.activity.startedAt.toISOString(),
      },
      deltaToPreviousSec: 50,
    });
    expect(comparisonOf(rides, best)).toMatchObject({
      isBest: true,
      deltaToBestSec: 0,
      previous: { id: first._id },
      deltaToPreviousSec: -100,
    });
    expect(comparisonOf(rides, rejected)).toEqual({
      best: expect.objectContaining({ id: best._id }),
      isBest: false,
      deltaToBestSec: null,
      previous: expect.objectContaining({ id: current._id }),
      deltaToPreviousSec: null,
    });
    expect(comparisonOf([first], first)).toMatchObject({
      isBest: true,
      deltaToBestSec: 0,
      previous: null,
      deltaToPreviousSec: null,
    });
  });

  it('summaryOf — count всех, passedCount, best', () => {
    const a = ride({ elapsed: 900, day: 0 });
    const b = ride({ elapsed: 800, day: 1 });
    const c = ride({ day: 2 });
    expect(summaryOf([a, b, c])).toEqual({
      count: 3,
      passedCount: 2,
      best: { id: b._id, elapsedSec: 800, rideStartedAt: b.activity.startedAt.toISOString() },
    });
    expect(summaryOf([])).toEqual({ count: 0, passedCount: 0, best: null });
  });

  it('sortRides — новые по дате заезда сверху, затем _id по убыванию', () => {
    const old = ride({ day: 0 });
    const newer = ride({ day: 3 });
    const twin = { ...ride({ day: 3 }), _id: id(999_999) };
    expect(sortRides([old, newer, twin]).map((r) => r._id)).toEqual([twin._id, newer._id, old._id]);
  });

  describe('кандидаты и существующий заезд группы', () => {
    const routeBounds: Bounds = [27.55, 53.9, 27.61, 53.95];
    const activity = (n: number, overrides: Partial<ActivityRef> = {}): ActivityRef => ({
      id: id(5000 + n),
      userId: id(900),
      uploadId: id(6000 + n),
      uploadCreatedAt: at(n),
      isPrimary: true,
      primaryId: id(5000 + n),
      sport: 'cycling',
      source: 'garmin',
      startedAt: at(-n * 60),
      endedAt: at(-n * 60 + 30),
      elapsedSec: 1800.4,
      distanceM: 8000.6,
      bounds: [27.56, 53.91, 27.6, 53.94],
      ...overrides,
    });

    it('candidateRows — без cycling_indoor, рамка у маршрута (600 м), ≤ 30, rideId через основную группы', () => {
      const near = activity(1);
      const indoor = activity(2, { sport: 'cycling_indoor' });
      // ≈ 1 км от рамки маршрута — вне запаса 600 м
      const far = activity(3, { bounds: [27.63, 53.96, 27.64, 53.97] });
      // ≈ 400 м от рамки — внутри запаса
      const edge = activity(4, { bounds: [27.616, 53.951, 27.62, 53.955] });
      const checked = ride({ activityId: id(7777) });
      const heads = new Map([[id(7777), { primaryId: near.id }]]);
      expect(candidateRows([near, indoor, far, edge], routeBounds, [checked], heads)).toEqual([
        {
          activityId: near.id,
          startedAt: near.startedAt.toISOString(),
          source: 'garmin',
          elapsedSec: 1800,
          distanceM: 8001,
          rideId: checked._id,
        },
        expect.objectContaining({ activityId: edge.id, rideId: null }),
      ]);
      const many = Array.from({ length: 40 }, (_, n) => activity(100 + n));
      expect(candidateRows(many, routeBounds, [], new Map())).toHaveLength(30);
    });

    it('findExisting — заезд, чья активность сейчас в группе с основной; удалённая (нет в карте) — нет', () => {
      const own = ride({ activityId: id(8001) });
      const gone = ride({ activityId: id(8002) });
      const heads = new Map([[id(8001), { primaryId: id(8003) }]]);
      expect(findExisting([gone, own], heads, id(8003))?._id).toBe(own._id);
      expect(findExisting([gone, own], heads, id(8002))).toBeUndefined();
    });
  });
});
