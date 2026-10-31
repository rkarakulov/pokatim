import { Logger } from '@nestjs/common';
import { RouteRideLeaderboard } from '@pokatim/contracts';
import { RateLimiter } from '@rkarakulov/api-kit/core';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { daysAgo, seedActivity } from '../../../test/achievements';
import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import {
  catalogCorridorRoute,
  ownCorridorRoute,
  ridesUrl,
  routeRidesDb,
} from '../../../test/route-rides';
import { rider } from '../../../test/results';
import { publicationDoc, routesDb, seedApprovedRiderRoute } from '../../../test/routes';
import { tracks } from '../../../test/tracks';
import { ProfileErasure } from '../profile';
import type { RouteRideDoc } from './route-rides.collection';
import { ROUTE_RIDE_LEADERBOARD_POLICY } from './route-rides.policy';
import { ROUTE_RIDES_LEADERBOARD_INDEX, RouteRidesRepository } from './route-rides.repository';

/**
 * Таблица «Другие» маршрута каталога (route-rides-04, AC1–AC6): HTTP через стенд; заезды — прямой вставкой поверх
 * живых активностей (`seedActivity`), согласие — `PATCH /v1/profile`.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const TEAM = '01890a5d-ac96-774b-bcce-b30209900002';
const UNKNOWN = '01890a5d-ac96-774b-bcce-b30209900099';

type Auth = Record<string, string>;
type Who = { email: string; auth: Auth; userId: string };

const board = (auth: Auth | undefined, routeId: string, query = '') =>
  call(h, 'GET', ridesUrl(routeId, `/leaderboard${query}`), undefined, auth);
async function table(who: Who, routeId: string, query = '') {
  const res = await board(who.auth, routeId, query);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return RouteRideLeaderboard.parse(res.body);
}
const patch = async (who: Who, body: Record<string, unknown>) => {
  const res = await call(h, 'PATCH', '/v1/profile', body, who.auth);
  expect(res.status).toBe(200);
};
const share = (who: Who, name?: string) =>
  patch(
    who,
    name
      ? { publicName: name, showNameInResults: true, showRouteRides: true }
      : { showRouteRides: true },
  );

/** Заезд маршрута прямой вставкой поверх новой живой активности; время сегмента — `elapsedSec`. */
async function seedRide(
  who: Who,
  routeId: string,
  elapsedSec: number,
  startedAt: Date,
  overrides: Partial<RouteRideDoc> = {},
): Promise<{ rideId: string; activityId: string }> {
  const activityId = await seedActivity(h, who.userId, startedAt);
  const rideId = uuidv7();
  const status = overrides.status ?? 'passed';
  await routeRidesDb(h).rides.insertOne({
    _id: rideId,
    userId: who.userId,
    routeId,
    activityId,
    activity: {
      startedAt,
      endedAt: new Date(startedAt.getTime() + 3_600_000),
      source: 'upload',
      elapsedSec: 3600,
      distanceM: 8000,
    },
    origin: 'manual',
    corridorWidthM: 50,
    status,
    checkRevision: 1,
    checkAttempts: 1,
    reasons: status === 'not_passed' ? ['no_finish'] : [],
    failure: status === 'failed' ? 'error' : null,
    segment:
      status === 'passed'
        ? {
            startedAt,
            finishedAt: new Date(startedAt.getTime() + elapsedSec * 1000),
            elapsedSec,
            distanceM: 8000,
            offCorridorM: 0,
            offCorridorShare: 0,
            maxExcursionM: 0,
            coverage: 1,
          }
        : null,
    touchedCorridor: status === 'passed' ? true : null,
    engineVersion: 1,
    trackMap: null,
    createdAt: h.clock.now(),
    updatedAt: h.clock.now(),
    checkedAt: h.clock.now(),
    ...overrides,
  });
  return { rideId, activityId };
}

describe('GET /v1/routes/:routeId/rides/leaderboard — доступ (AC5)', () => {
  it('гость — 401; не каталог, свой неопубликованный, снятый, на модерации, неизвестный — 404; limit вне 1–100 и лишний ключ — 400', async () => {
    const me = await rider(h, 'me@example.com');
    const catalog = await catalogCorridorRoute(h, TEAM);
    expect((await board(undefined, catalog)).status).toBe(401);

    const offCatalog = await catalogCorridorRoute(h, TEAM);
    await routesDb(h).routes.updateOne({ _id: offCatalog }, { $set: { catalog: null } });
    const hidden = [
      offCatalog,
      await ownCorridorRoute(h, me.userId),
      await ownCorridorRoute(h, TEAM, { publication: publicationDoc(h, 'pending') }),
      await ownCorridorRoute(h, TEAM, { publication: publicationDoc(h, 'withdrawn') }),
      UNKNOWN,
    ];
    for (const id of hidden) {
      const res = await board(me.auth, id);
      expect([res.status, (res.body as { code: string }).code], id).toEqual([404, 'NOT_FOUND']);
    }
    for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?cursor=x']) {
      expect((await board(me.auth, catalog, query)).status, query).toBe(400);
    }
    expect((await board(me.auth, 'not-a-uuid')).status).toBe(400);
  });

  it('одобренный маршрут райдера — таблица есть и у автора (O2)', async () => {
    const author = await rider(h, 'author@example.com');
    const other = await rider(h, 'other@example.com');
    const approved = await seedApprovedRiderRoute(h, author.userId);
    await share(other);
    await seedRide(other, approved, 900, daysAgo(h, 2));
    expect((await table(author, approved)).rows.map((row) => row.elapsedSec)).toEqual([900]);
  });
});

describe('строки таблицы (AC1–AC3)', () => {
  it('без согласия чужие не видны; с согласием — лучший живой пройденный; имя/ссылка/фото только с showNameInResults', async () => {
    const me = await rider(h, 'me@example.com');
    const anna = await rider(h, 'anna@example.com');
    const boris = await rider(h, 'boris@example.com');
    const quiet = await rider(h, 'quiet@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    await seedRide(anna, routeId, 900, daysAgo(h, 5));
    await seedRide(anna, routeId, 800, daysAgo(h, 3));
    await seedRide(anna, routeId, 600, daysAgo(h, 2), { status: 'not_passed' });
    await seedRide(boris, routeId, 850, daysAgo(h, 4));
    await seedRide(boris, routeId, 500, daysAgo(h, 1), { status: 'failed' });
    await seedRide(quiet, routeId, 700, daysAgo(h, 4));

    expect(await table(me, routeId)).toEqual({ rows: [], total: 0, me: null, shared: false });

    await share(anna, 'Анна К.');
    await share(boris);
    const view = await table(me, routeId);
    const annaProfile = await call(h, 'GET', '/v1/profile', undefined, anna.auth);
    expect(view.rows).toEqual([
      {
        place: 1,
        elapsedSec: 800,
        rideDate: '2026-10-19',
        riderName: 'Анна К.',
        riderPublicId: (annaProfile.body as { publicId: string }).publicId,
        riderAvatar: null,
        rideId: null,
      },
      {
        place: 2,
        elapsedSec: 850,
        rideDate: '2026-10-18',
        riderName: null,
        riderPublicId: null,
        riderAvatar: null,
        rideId: null,
      },
    ]);
    expect(view.total).toBe(2);
  });

  it('удалённая лучшая активность — строка по следующему живому; все топ-3 удалены — строки нет', async () => {
    const me = await rider(h, 'me@example.com');
    const anna = await rider(h, 'anna@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    await share(anna);
    const best = await seedRide(anna, routeId, 700, daysAgo(h, 5));
    const second = await seedRide(anna, routeId, 750, daysAgo(h, 4));
    const third = await seedRide(anna, routeId, 760, daysAgo(h, 3));
    await tracks(h).activities.deleteOne({ _id: best.activityId });
    expect((await table(me, routeId)).rows.map((row) => row.elapsedSec)).toEqual([750]);
    await tracks(h).activities.deleteMany({
      _id: { $in: [second.activityId, third.activityId] },
    });
    expect(await table(me, routeId)).toMatchObject({ rows: [], total: 0 });
  });

  it('отзыв согласия и стирание профиля — строки нет; автозаезд участвует наравне с ручным', async () => {
    const me = await rider(h, 'me@example.com');
    const anna = await rider(h, 'anna@example.com');
    const boris = await rider(h, 'boris@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    await share(anna);
    await share(boris);
    await seedRide(anna, routeId, 800, daysAgo(h, 3), { origin: 'auto' });
    await seedRide(boris, routeId, 850, daysAgo(h, 3));
    expect((await table(me, routeId)).rows.map((row) => row.elapsedSec)).toEqual([800, 850]);

    await patch(anna, { showRouteRides: false });
    expect((await table(me, routeId)).rows.map((row) => row.elapsedSec)).toEqual([850]);

    await h.app.get(ProfileErasure, { strict: false }).erase(boris.userId);
    expect(await table(me, routeId)).toMatchObject({ rows: [], total: 0 });
  });

  it('снятие маршрута с каталога — 404 (строк нет)', async () => {
    const me = await rider(h, 'me@example.com');
    const anna = await rider(h, 'anna@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    await share(anna);
    await seedRide(anna, routeId, 800, daysAgo(h, 3));
    expect((await table(me, routeId)).total).toBe(1);
    await routesDb(h).routes.updateOne({ _id: routeId }, { $set: { catalog: null } });
    expect((await board(me.auth, routeId)).status).toBe(404);
  });
});

describe('своя строка (AC2, O4)', () => {
  it('зритель без согласия видит себя (shared: false, места сдвинуты); второй зритель его не видит; с согласием — видит', async () => {
    const me = await rider(h, 'me@example.com');
    const anna = await rider(h, 'anna@example.com');
    const boris = await rider(h, 'boris@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    await share(anna);
    await share(boris);
    await seedRide(anna, routeId, 700, daysAgo(h, 5));
    await seedRide(boris, routeId, 900, daysAgo(h, 5));
    await seedRide(me, routeId, 820, daysAgo(h, 6));
    const mine = await seedRide(me, routeId, 800, daysAgo(h, 4));

    const view = await table(me, routeId);
    expect(view.shared).toBe(false);
    expect(view.rows.map((row) => [row.place, row.elapsedSec, row.rideId])).toEqual([
      [1, 700, null],
      [2, 800, mine.rideId],
      [3, 900, null],
    ]);
    expect(view.me).toEqual({
      place: 2,
      elapsedSec: 800,
      rideDate: '2026-10-18',
      rideId: mine.rideId,
    });
    expect(view.total).toBe(3);
    // время своей строки = лучший в «Моих заездах»
    const own = await call(h, 'GET', ridesUrl(routeId), undefined, me.auth);
    expect((own.body as { summary: { best: { id: string } } }).summary.best.id).toBe(mine.rideId);

    expect((await table(anna, routeId)).rows.map((row) => row.elapsedSec)).toEqual([700, 900]);
    await share(me);
    expect((await table(me, routeId)).shared).toBe(true);
    expect((await table(anna, routeId)).rows.map((row) => row.elapsedSec)).toEqual([700, 800, 900]);
  });

  it('me вне limit — в me, не в rows; ключи ответа и строки — точный список; no-store', async () => {
    const me = await rider(h, 'me@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    for (const [i, email] of ['a@example.com', 'b@example.com'].entries()) {
      const other = await rider(h, email);
      await share(other);
      await seedRide(other, routeId, 600 + i, daysAgo(h, 3));
    }
    const mine = await seedRide(me, routeId, 900, daysAgo(h, 2));

    const res = await board(me.auth, routeId, '?limit=1');
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as Record<string, unknown> & { rows: Record<string, unknown>[] };
    expect(Object.keys(body).sort()).toEqual(['me', 'rows', 'shared', 'total']);
    expect(body.rows).toHaveLength(1);
    expect(Object.keys(body.rows[0]!).sort()).toEqual([
      'elapsedSec',
      'place',
      'rideDate',
      'rideId',
      'riderAvatar',
      'riderName',
      'riderPublicId',
    ]);
    expect(body.rows[0]!.rideId).toBeNull();
    expect(body.me).toEqual({
      place: 3,
      elapsedSec: 900,
      rideDate: '2026-10-20',
      rideId: mine.rideId,
    });
    expect(body.total).toBe(3);
    expect(JSON.stringify(body)).not.toContain(me.userId);
  });

  it('без своего живого пройденного заезда — me: null', async () => {
    const me = await rider(h, 'me@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    const gone = await seedRide(me, routeId, 800, daysAgo(h, 2));
    await seedRide(me, routeId, 700, daysAgo(h, 1), { status: 'not_passed' });
    await tracks(h).activities.deleteOne({ _id: gone.activityId });
    expect(await table(me, routeId)).toEqual({ rows: [], total: 0, me: null, shared: false });
  });
});

describe('злоупотребления и запрос', () => {
  it('лимит 300/ч на пользователя — 429 RATE_LIMITED с retryAfterSec; 404 тоже тратит лимит', async () => {
    const me = await rider(h, 'me@example.com');
    const routeId = await catalogCorridorRoute(h, TEAM);
    const { userLimit } = ROUTE_RIDE_LEADERBOARD_POLICY;
    expect(userLimit).toEqual({ limit: 300, windowSec: 3600 });
    const limiter = h.app.get(RateLimiter);
    for (let i = 0; i < userLimit.limit - 1; i += 1) {
      await limiter.consume(`route-rides-leaderboard:${me.userId}`, userLimit, h.clock.now());
    }
    expect((await board(me.auth, UNKNOWN)).status).toBe(404);
    const limited = await board(me.auth, routeId);
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
    const other = await rider(h, 'other@example.com');
    expect((await board(other.auth, routeId)).status).toBe(200);
  });

  it('усечение скана — лучшие райдеры по лучшему из топ-3 (до фильтров) и лог без userId', async () => {
    const routeId = await catalogCorridorRoute(h, TEAM);
    const riders = await Promise.all(
      ['a@example.com', 'b@example.com', 'c@example.com'].map((email) => rider(h, email)),
    );
    await seedRide(riders[0]!, routeId, 900, daysAgo(h, 3));
    await seedRide(riders[1]!, routeId, 700, daysAgo(h, 3));
    await seedRide(riders[1]!, routeId, 710, daysAgo(h, 2));
    await seedRide(riders[2]!, routeId, 800, daysAgo(h, 3));
    const repository = h.app.get(RouteRidesRepository, { strict: false });
    const top = await repository.leaderboardTop(routeId, 2, 3);
    expect(top.map((row) => [row.userId, row.top.map((ride) => ride.elapsedSec)])).toEqual([
      [riders[1]!.userId, [700, 710]],
      [riders[2]!.userId, [800]],
    ]);

    const original = repository.leaderboardTop.bind(repository);
    const { scanRiders } = ROUTE_RIDE_LEADERBOARD_POLICY;
    // агрегат отдаёт `found` райдеров (не больше запрошенного предела)
    const scanOf = (found: number) =>
      vi.spyOn(repository, 'leaderboardTop').mockImplementation(async (id, limit) => {
        const rows = await original(id, 3, 3);
        return Array.from({ length: Math.min(found, limit) }, (_, i) => ({
          ...rows[i % rows.length]!,
          userId: `${rows[i % rows.length]!.userId}-${i}`,
        }));
      });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const me = await rider(h, 'me@example.com');
    const truncated = `route_rides.leaderboard_truncated route=${routeId}`;
    const logs = () => warn.mock.calls.map((args) => String(args[0]));

    // ровно предел — не усечение, лога нет
    scanOf(scanRiders);
    expect((await board(me.auth, routeId)).status).toBe(200);
    expect(logs()).not.toContain(truncated);

    // на одного больше — лог, без userId
    scanOf(scanRiders + 1);
    expect((await board(me.auth, routeId)).status).toBe(200);
    expect(logs()).toContain(truncated);
    expect(logs().join('\n')).not.toContain(riders[0]!.userId);
  });

  it('план агрегата — IXSCAN по route_rides_leaderboard_idx', async () => {
    const routeId = await catalogCorridorRoute(h, TEAM);
    const anna = await rider(h, 'anna@example.com');
    await seedRide(anna, routeId, 800, daysAgo(h, 3));
    const explain = await routeRidesDb(h)
      .rides.aggregate(
        [{ $match: { routeId, status: 'passed' } }, { $group: { _id: '$userId', n: { $sum: 1 } } }],
        { hint: ROUTE_RIDES_LEADERBOARD_INDEX },
      )
      .explain('queryPlanner');
    expect(JSON.stringify(explain)).toContain('"indexName":"route_rides_leaderboard_idx"');
    expect(JSON.stringify(explain)).toContain('IXSCAN');
  });
});
