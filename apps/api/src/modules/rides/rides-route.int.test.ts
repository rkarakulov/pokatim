import { CITY_CENTERS, RideDetail, RideMap, RidePage, RideView } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness, MINUTE } from '../../../test/harness';
import { call } from '../../../test/identity';
import { eventsOfType } from '../../../test/notifications';
import {
  MY_ROUTES,
  publicationDoc,
  riderCall,
  routesDb,
  seedRiderRoute,
  withdrawPublication,
} from '../../../test/routes';
import {
  authed,
  createRide,
  fieldCodesOf,
  join,
  nearQuery,
  RIDES,
  rideBody,
  rider,
  ridesDb,
  seedApprovedRoute,
  seedTeamRoute,
  startsIn,
  type Rider,
} from '../../../test/rides';
import { RIDE_ROUTES, type RideRoutes } from '../routes';
import { RideErasure } from './ride-erasure';
import type { RideDoc } from './rides.collection';
import { RIDES_POLICY } from './rides.policy';

/**
 * Маршрут райда и «Рядом» (05c, AC1–AC6, 8.3): прикрепление (каталог или свой готовый, один отказ без оракула),
 * видимость маршрута и старта на каждом чтении, точка «Рядом» и перенос, лента по радиусу, карта ленты, лимит
 * `rides-near`, сброс точек при стирании, порт `RideRoutes` без кэша.
 */
let h: Harness;
let organizer: Rider;
let other: Rider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  other = await rider(h, 'other@example.by');
});
afterAll(async () => {
  await h.close();
});

const TEAM_START: [number, number] = [27.6, 53.95];
const point = (coordinates: readonly [number, number]) => ({
  type: 'Point',
  coordinates: [...coordinates],
});
const minskCenter = point(CITY_CENTERS.minsk);

let ipCounter = 0;
const publicGet = (url: string) =>
  call(h, 'GET', url, undefined, { 'x-forwarded-for': `203.0.113.${(ipCounter++ % 200) + 1}` });

const me = async (who: Rider, id: string) =>
  RideView.parse((await authed(h, who, 'GET', `${RIDES}/${id}/me`)).body).ride;
const feed = async (who: Rider, query = '') =>
  RidePage.parse((await authed(h, who, 'GET', `${RIDES}${query ? `?${query}` : ''}`)).body);
const stored = async (id: string) => (await ridesDb(h).findOne({ _id: id })) as RideDoc;
const update = (id: string, body: Record<string, unknown>) =>
  authed(h, organizer, 'POST', `${RIDES}/${id}`, body);

/** Ключи JSON на любой глубине. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      keysOf(nested, into);
    }
  }
  return into;
}

describe('прикрепление маршрута (AC1–AC3)', () => {
  it('AC1: маршрут команды из каталога — public, start = старт маршрута; в БД точная точка', async () => {
    const routeId = await seedTeamRoute(h, TEAM_START);
    const res = await authed(h, organizer, 'POST', RIDES, rideBody(h, { routeId }));
    expect(res.status).toBe(201);
    const ride = RideView.parse(res.body).ride;
    expect(ride.route).toEqual({
      id: routeId,
      title: 'Кольцо команды',
      distanceM: 1300,
      elevationGainM: 120,
      access: 'public',
    });
    expect(ride.start).toEqual(TEAM_START);
    expect(await stored(ride.id)).toMatchObject({
      routeId,
      geo: point(TEAM_START),
      startPrecise: true,
    });
    // другому райдеру, в ленте и гостю — тот же маршрут
    expect((await me(other, ride.id)).route?.access).toBe('public');
    expect((await feed(other)).items[0]?.start).toEqual(TEAM_START);
    expect(RideDetail.parse((await publicGet(`${RIDES}/${ride.id}`)).body).route?.id).toBe(routeId);
  });

  it('AC1: одобренный маршрут другого райдера — так же public', async () => {
    const routeId = await seedApprovedRoute(h, other.userId, [27.62, 53.96]);
    const ride = await createRide(h, organizer, { routeId });
    expect(ride.route?.access).toBe('public');
    expect(ride.start).toEqual([27.62, 53.96]);
    expect((await stored(ride.id)).startPrecise).toBe(true);
  });

  it('AC2: свой маршрут на модерации — организатору private со стартом; другим и гостю — null; точка — центр города', async () => {
    const routeId = await seedRiderRoute(h, organizer.userId, {
      publication: publicationDoc(h, 'pending'),
    });
    const ride = await createRide(h, organizer, { routeId });
    expect(ride.route).toMatchObject({ id: routeId, access: 'private' });
    expect(ride.start).toEqual([27.55, 53.9]);
    expect((await me(organizer, ride.id)).route?.access).toBe('private');

    expect(await me(other, ride.id)).toMatchObject({ route: null, start: null });
    expect((await feed(other)).items[0]).toMatchObject({ id: ride.id, route: null, start: null });
    const guest = RideDetail.parse((await publicGet(`${RIDES}/${ride.id}`)).body);
    expect(guest).toMatchObject({ route: null, start: null });
    expect(await stored(ride.id)).toMatchObject({ geo: minskCenter, startPrecise: false });
  });

  it('AC3: чужой непубличный, несуществующий, processing, failed, команды не в каталоге — один и тот же 400 routeId', async () => {
    const foreign = await seedRiderRoute(h, other.userId, {
      publication: publicationDoc(h, 'pending'),
    });
    const processing = await seedRiderRoute(h, organizer.userId, { status: 'processing' });
    const failed = await seedRiderRoute(h, organizer.userId, { status: 'failed' });
    const unpublishedTeam = await seedTeamRoute(h);
    await routesDb(h).routes.updateOne({ _id: unpublishedTeam }, { $set: { catalog: null } });
    // защита в глубину: catalog у маршрута райдера без approved — не каталог
    const forgedCatalog = await seedRiderRoute(h, other.userId, {
      publication: publicationDoc(h, 'pending'),
      catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() },
    });
    const bodies = new Set<string>();
    for (const routeId of [foreign, uuidv7(), processing, failed, unpublishedTeam, forgedCatalog]) {
      const res = await authed(h, organizer, 'POST', RIDES, rideBody(h, { routeId }));
      expect(res.status, routeId).toBe(400);
      expect(fieldCodesOf(res.body)).toEqual([{ path: 'routeId', code: 'RIDE_ROUTE_UNAVAILABLE' }]);
      bodies.add(JSON.stringify(res.body));
    }
    expect(bodies.size).toBe(1);
    expect(await ridesDb(h).countDocuments()).toBe(0);

    // правка — тот же отказ, райд не меняется
    const ride = await createRide(h, organizer);
    const res = await update(ride.id, { version: 0, routeId: foreign });
    expect(res.status).toBe(400);
    expect(bodies.has(JSON.stringify(res.body))).toBe(true);
    expect(await stored(ride.id)).toMatchObject({ version: 0, routeId: null });
  });
});

describe('маршрут снят после прикрепления (AC4)', () => {
  it('чужой одобренный маршрут отозван автором — всем null, 200; точный старт наружу не уходит', async () => {
    const routeId = await seedApprovedRoute(h, other.userId);
    const ride = await createRide(h, organizer, { routeId });
    expect((await withdrawPublication(h, other.token, routeId)).status).toBe(200);
    const third = await rider(h, 'third@example.by');
    expect(await me(third, ride.id)).toMatchObject({ route: null, start: null });
    expect(await me(organizer, ride.id)).toMatchObject({ route: null, start: null });
    // автор маршрута не организатор: свой маршрут в чужом райде — не private
    expect(await me(other, ride.id)).toMatchObject({ route: null, start: null });
    expect((await feed(third)).items[0]).toMatchObject({ route: null, start: null });
    const guest = await publicGet(`${RIDES}/${ride.id}`);
    expect(guest.status).toBe(200);
    expect(RideDetail.parse(guest.body)).toMatchObject({ route: null, start: null });
  });

  it('свой маршрут скрыт модератором — другим null, организатору private; удалён автором — null всем', async () => {
    const routeId = await seedApprovedRoute(h, organizer.userId);
    const ride = await createRide(h, organizer, { routeId });
    await routesDb(h).routes.updateOne(
      { _id: routeId },
      { $set: { 'publication.status': 'hidden', catalog: null } },
    );
    expect(await me(other, ride.id)).toMatchObject({ route: null, start: null });
    expect((await me(organizer, ride.id)).route?.access).toBe('private');

    const deleted = await riderCall(
      h,
      organizer.token,
      'POST',
      `${MY_ROUTES}/${routeId}/delete`,
      {},
    );
    expect(deleted.status).toBe(204);
    const res = await authed(h, organizer, 'GET', `${RIDES}/${ride.id}/me`);
    expect(res.status).toBe(200);
    expect(RideView.parse(res.body).ride).toMatchObject({ route: null, start: null });
    expect(await me(other, ride.id)).toMatchObject({ route: null, start: null });
  });
});

describe('точка старта и перенос (RC-3, RC-4)', () => {
  it('RC-3: свой маршрут одобрен после прикрепления — любая правка «повышает» точку, без переноса', async () => {
    const routeId = await seedRiderRoute(h, organizer.userId, {
      publication: publicationDoc(h, 'pending'),
    });
    const ride = await createRide(h, organizer, { routeId });
    await join(h, other, ride.id);
    await routesDb(h).routes.updateOne(
      { _id: routeId },
      {
        $set: {
          publication: publicationDoc(h, 'approved'),
          catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() },
        },
      },
    );
    // участникам карта видна сразу (проверка на чтении), точка — после правки
    expect((await me(other, ride.id)).route?.access).toBe('public');
    expect((await stored(ride.id)).startPrecise).toBe(false);

    const res = await update(ride.id, { version: 0, title: 'Новое название' });
    expect(res.status).toBe(200);
    expect(RideView.parse(res.body).ride.rescheduledAt).toBeNull();
    expect(await stored(ride.id)).toMatchObject({ geo: point([27.55, 53.9]), startPrecise: true });
    expect(await eventsOfType(h, 'rides.ride-rescheduled')).toEqual([]);
  });

  it('RC-4: смена маршрута на другой с иным стартом при участниках — перенос и одно событие', async () => {
    const first = await seedTeamRoute(h, TEAM_START);
    const second = await seedTeamRoute(h, [27.7, 53.92], 'Второе кольцо');
    const ride = await createRide(h, organizer, { routeId: first });
    await join(h, other, ride.id);
    const res = await update(ride.id, { version: 0, routeId: second });
    expect(res.status).toBe(200);
    const view = RideView.parse(res.body).ride;
    expect(view).toMatchObject({ route: { id: second }, start: [27.7, 53.92] });
    expect(view.rescheduledAt).toBe(h.clock.now().toISOString());
    expect(await stored(ride.id)).toMatchObject({ geo: point([27.7, 53.92]), startPrecise: true });
    expect((await eventsOfType(h, 'rides.ride-rescheduled')).map((e) => e.payload)).toEqual([
      { rideId: ride.id },
    ]);
  });

  it('A4: прикрепить маршрут к райду без маршрута и снять его — не перенос', async () => {
    const routeId = await seedTeamRoute(h, TEAM_START);
    const ride = await createRide(h, organizer);
    await join(h, other, ride.id);
    const attached = await update(ride.id, { version: 0, routeId });
    expect(RideView.parse(attached.body).ride).toMatchObject({
      start: TEAM_START,
      rescheduledAt: null,
    });
    const detached = await update(ride.id, { version: 1, routeId: null });
    expect(RideView.parse(detached.body).ride).toMatchObject({
      route: null,
      start: null,
      rescheduledAt: null,
    });
    expect(await stored(ride.id)).toMatchObject({
      routeId: null,
      geo: minskCenter,
      startPrecise: false,
    });
    expect(await eventsOfType(h, 'rides.ride-rescheduled')).toEqual([]);
  });

  it('правка без routeId маршрут не снимает (старая сборка)', async () => {
    const routeId = await seedTeamRoute(h, TEAM_START);
    const ride = await createRide(h, organizer, { routeId });
    const res = await update(ride.id, { version: 0, title: 'Другое название' });
    expect(RideView.parse(res.body).ride).toMatchObject({
      route: { id: routeId },
      start: TEAM_START,
    });
    expect(await stored(ride.id)).toMatchObject({ routeId, startPrecise: true });
  });

  it('смена города: без маршрута — центр нового города; с точным маршрутом — точка та же', async () => {
    const plain = await createRide(h, organizer);
    await update(plain.id, { version: 0, cityCode: 'brest' });
    expect(await stored(plain.id)).toMatchObject({
      geo: point(CITY_CENTERS.brest),
      startPrecise: false,
    });

    const routeId = await seedTeamRoute(h, TEAM_START);
    const precise = await createRide(h, organizer, { routeId });
    await update(precise.id, { version: 0, cityCode: 'gomel' });
    expect(await stored(precise.id)).toMatchObject({ geo: point(TEAM_START), startPrecise: true });
  });
});

describe('«Рядом» (AC5)', () => {
  it('райды в радиусе (точные и по центру города), вне — нет; по времени; курсор; near + город — И; без geo в ответе', async () => {
    const near = await seedTeamRoute(h, TEAM_START);
    const far = await seedTeamRoute(h, [28.2, 53.9], 'Далеко');
    const minskPrecise = await createRide(h, organizer, {
      routeId: near,
      startsAt: startsIn(h, 2 * DAY),
    });
    const minskPlain = await createRide(h, organizer, { startsAt: startsIn(h, DAY) });
    await createRide(h, organizer, { cityCode: 'brest', startsAt: startsIn(h, 3 * DAY) });
    await createRide(h, other, { routeId: far, startsAt: startsIn(h, 4 * DAY) });

    const query = nearQuery(53.9, 27.56, 25);
    const res = await authed(h, other, 'GET', `${RIDES}?${query}`);
    expect(res.status).toBe(200);
    const page = RidePage.parse(res.body);
    expect(page.items.map((item) => item.id)).toEqual([minskPlain.id, minskPrecise.id]);
    for (const key of ['geo', 'startPrecise', 'routeId', 'near']) {
      expect(keysOf(res.body)).not.toContain(key);
    }

    const first = await feed(other, `${query}&limit=1`);
    expect(first.items.map((item) => item.id)).toEqual([minskPlain.id]);
    const second = await feed(other, `${query}&limit=1&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.id)).toEqual([minskPrecise.id]);
    expect(second.nextCursor).toBeNull();

    expect((await feed(other, `${query}&city=brest`)).items).toEqual([]);
    // радиус по умолчанию — 25 км; 100 км — и дальний точный старт
    expect((await feed(other, nearQuery(53.9, 27.56))).items).toHaveLength(2);
    expect((await feed(other, nearQuery(53.9, 27.56, 100))).items).toHaveLength(3);
  });

  it('невалидные near и radiusKm — 400', async () => {
    for (const query of [
      'near=91,0',
      'near=abc',
      'near=53.9',
      'radiusKm=25',
      'near=53.9,27.56&radiusKm=4',
    ]) {
      const res = await authed(h, other, 'GET', `${RIDES}?${query}`);
      expect(res.status, query).toBe(400);
      expect((res.body as { code: string }).code).toBe('VALIDATION_FAILED');
    }
  });

  it('лимит rides-near: 61-й запрос с near — 429 + Retry-After; без near не считается', async () => {
    for (let i = 0; i <= RIDES_POLICY.nearLimit.limit; i++) {
      expect((await authed(h, other, 'GET', RIDES)).status).toBe(200);
    }
    for (let i = 0; i < RIDES_POLICY.nearLimit.limit; i++) {
      const res = await authed(h, other, 'GET', `${RIDES}?${nearQuery(53.9, 27.56)}`);
      expect(res.status).toBe(200);
    }
    const limited = await authed(h, other, 'GET', `${RIDES}/map`);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect((await authed(h, organizer, 'GET', `${RIDES}?${nearQuery(53.9, 27.56)}`)).status).toBe(
      200,
    );
  });
});

describe('карта ленты (AC6)', () => {
  it('только точные точки с видимым маршрутом, будущие опубликованные; остальные — withoutStart; no-store', async () => {
    const team = await seedTeamRoute(h, TEAM_START);
    const withdrawn = await seedApprovedRoute(h, other.userId, [27.5, 53.88]);
    const visible = await createRide(h, organizer, { routeId: team, startsAt: startsIn(h, DAY) });
    const lost = await createRide(h, organizer, { routeId: withdrawn });
    await createRide(h, organizer); // без маршрута
    const cancelled = await createRide(h, organizer, { routeId: team });
    await authed(h, organizer, 'POST', `${RIDES}/${cancelled.id}/cancel`, { reason: 'weather' });
    const past = await createRide(h, other, { routeId: team });
    await ridesDb(h).updateOne(
      { _id: past.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - MINUTE) } },
    );
    const hidden = await createRide(h, other, { routeId: team });
    await ridesDb(h).updateOne({ _id: hidden.id }, { $set: { status: 'hidden' } });
    await withdrawPublication(h, other.token, withdrawn);

    const res = await authed(h, organizer, 'GET', `${RIDES}/map`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const map = RideMap.parse(res.body);
    expect(map.items).toEqual([
      {
        id: visible.id,
        title: visible.title,
        startsAt: visible.startsAt,
        start: TEAM_START,
        goingCount: 1,
        limit: 12,
        full: false,
      },
    ]);
    // снятый маршрут и райд без маршрута — без точки, но в счётчике
    expect(map.withoutStart).toBe(2);
    expect(lost.id).not.toBe(visible.id);

    const brest = RideMap.parse(
      (await authed(h, organizer, 'GET', `${RIDES}/map?city=brest`)).body,
    );
    expect(brest).toEqual({ items: [], withoutStart: 0 });
    const nearby = RideMap.parse(
      (await authed(h, organizer, 'GET', `${RIDES}/map?${nearQuery(53.9, 27.56, 10)}`)).body,
    );
    expect(nearby.items.map((item) => item.id)).toEqual([visible.id]);
  });

  it('не больше 200 точек по времени; без входа — 401; путь map не уходит в pipe Uuid', async () => {
    const team = await seedTeamRoute(h, TEAM_START);
    const template = await createRide(h, organizer, { routeId: team });
    const doc = await stored(template.id);
    await ridesDb(h).deleteMany({});
    await ridesDb(h).insertMany(
      Array.from({ length: 201 }, (_, i) => ({
        ...doc,
        _id: uuidv7(),
        startsAt: new Date(h.clock.now().getTime() + DAY + i * MINUTE),
      })),
    );
    const map = RideMap.parse((await authed(h, organizer, 'GET', `${RIDES}/map`)).body);
    expect(map.items).toHaveLength(200);
    expect(map.withoutStart).toBe(1);
    const times = map.items.map((item) => item.startsAt);
    expect(times).toEqual([...times].sort());

    expect((await call(h, 'GET', `${RIDES}/map`)).status).toBe(401);
    expect((await authed(h, organizer, 'GET', `${RIDES}/map?limit=5`)).status).toBe(400);
  });
});

describe('точка «Рядом» после снятия маршрута (RC-1, фиксы ревью pass 1)', () => {
  const mapOf = async (query = '') =>
    RideMap.parse((await authed(h, other, 'GET', `${RIDES}/map${query ? `?${query}` : ''}`)).body);
  const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);
  const [borisovLon, borisovLat] = CITY_CENTERS.borisov;
  const minsk = nearQuery(53.9, 27.56, 25);
  const borisov = nearQuery(borisovLat, borisovLon, 10);

  it('отозван и удалён автором — «Рядом» и карта по центру города, старый старт не матчится (до стирания)', async () => {
    const withdrawn = await seedApprovedRoute(h, other.userId, [27.62, 53.96]);
    const deleted = await seedApprovedRoute(h, other.userId, [27.6, 53.92]);
    const a = await createRide(h, organizer, {
      routeId: withdrawn,
      cityCode: 'borisov',
      startsAt: startsIn(h, DAY),
    });
    const b = await createRide(h, organizer, {
      routeId: deleted,
      cityCode: 'borisov',
      startsAt: startsIn(h, 2 * DAY),
    });
    expect(ids(await feed(other, minsk))).toEqual([a.id, b.id]);
    expect(ids(await mapOf(minsk))).toEqual([a.id, b.id]);
    expect(ids(await feed(other, borisov))).toEqual([]);

    expect((await withdrawPublication(h, other.token, withdrawn)).status).toBe(200);
    const removed = await riderCall(h, other.token, 'POST', `${MY_ROUTES}/${deleted}/delete`, {});
    expect(removed.status).toBe(204);
    // в БД точка ещё точная (стирания не было) — чтение её не использует
    expect((await stored(b.id)).startPrecise).toBe(true);

    expect(ids(await feed(other, minsk))).toEqual([]);
    expect(ids(await feed(other, borisov))).toEqual([a.id, b.id]);
    expect(await mapOf(minsk)).toEqual({ items: [], withoutStart: 0 });
    expect(await mapOf(borisov)).toEqual({ items: [], withoutStart: 2 });
    expect(await mapOf()).toEqual({ items: [], withoutStart: 2 });
  });

  it('свой маршрут организатора скрыт модератором — не точка карты и не «Рядом» по старту и организатору', async () => {
    const routeId = await seedApprovedRoute(h, organizer.userId, [27.62, 53.96]);
    const ride = await createRide(h, organizer, { routeId, cityCode: 'borisov' });
    await routesDb(h).routes.updateOne(
      { _id: routeId },
      { $set: { 'publication.status': 'hidden', catalog: null } },
    );
    const own = RideMap.parse((await authed(h, organizer, 'GET', `${RIDES}/map`)).body);
    expect(own).toEqual({ items: [], withoutStart: 1 });
    const page = RidePage.parse((await authed(h, organizer, 'GET', `${RIDES}?${minsk}`)).body);
    expect(page.items).toEqual([]);
    expect(ids(await feed(organizer, borisov))).toEqual([ride.id]);
  });

  it('курсор: отброшенные строки не теряют продолжение; пустая страница добирается следующими пачками', async () => {
    const withdrawn = await seedApprovedRoute(h, other.userId, [27.62, 53.96]);
    const team = await seedTeamRoute(h, TEAM_START);
    const lost = [];
    for (let i = 0; i < 3; i++) {
      lost.push(
        await createRide(h, organizer, {
          routeId: withdrawn,
          cityCode: 'borisov',
          startsAt: startsIn(h, DAY + i * MINUTE * 10),
        }),
      );
    }
    const kept = await createRide(h, other, { routeId: team, startsAt: startsIn(h, 2 * DAY) });
    const plain = await createRide(h, other, { startsAt: startsIn(h, 3 * DAY) });
    await withdrawPublication(h, other.token, withdrawn);

    const first = await feed(organizer, `${minsk}&limit=1`);
    expect(ids(first)).toEqual([kept.id]);
    expect(first.nextCursor).not.toBeNull();
    const second = await feed(organizer, `${minsk}&limit=1&cursor=${first.nextCursor}`);
    expect(ids(second)).toEqual([plain.id]);
    expect(second.nextCursor).toBeNull();
    expect(ids(await feed(organizer, minsk))).toEqual([kept.id, plain.id]);
    expect(lost).toHaveLength(3);
  });

  it('предел пачек: пустая страница с курсором, продолжение не теряется', async () => {
    // кандидаты по городу (Минск в круге), чья точка сейчас — публичный старт вне круга: отбрасываются после чтения
    const far = await seedTeamRoute(h, [28.2, 53.9], 'Далеко');
    const template = await stored((await createRide(h, organizer, { routeId: far })).id);
    await ridesDb(h).deleteMany({});
    const at = (i: number) => new Date(h.clock.now().getTime() + DAY + i * MINUTE);
    await ridesDb(h).insertMany(
      Array.from({ length: 12 }, (_, i) => ({ ...template, _id: uuidv7(), startsAt: at(i) })),
    );
    const kept = await createRide(h, other, { startsAt: startsIn(h, 2 * DAY) });

    const first = await feed(organizer, `${minsk}&limit=1`);
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await feed(organizer, `${minsk}&limit=1&cursor=${first.nextCursor}`);
    expect(ids(second)).toEqual([kept.id]);
    expect(second.nextCursor).toBeNull();
  });

  it('оракул курсора закрыт (pass 2): сохранённая точка райда на снятом маршруте не меняет ни страниц, ни курсоров', async () => {
    const withdrawn = await seedApprovedRoute(h, other.userId, [27.62, 53.96]);
    const far = await seedTeamRoute(h, [28.2, 53.9], 'Далеко');
    const hiddenTpl = await stored(
      (await createRide(h, organizer, { routeId: withdrawn, cityCode: 'borisov' })).id,
    );
    const farTpl = await stored((await createRide(h, organizer, { routeId: far })).id);
    const plainTpl = await stored((await createRide(h, organizer, {})).id);
    await withdrawPublication(h, other.token, withdrawn);
    const at = (i: number) => new Date(h.clock.now().getTime() + DAY + i * MINUTE);
    const hiddenIds = Array.from({ length: 12 }, () => uuidv7());
    const farIds = Array.from({ length: 12 }, () => uuidv7());
    const plainIds = [uuidv7(), uuidv7()];

    /** Тот же набор райдов; различается только сохранённая точка райдов на снятом маршруте. */
    const seed = async (hiddenGeo: readonly [number, number]) => {
      await ridesDb(h).deleteMany({});
      await ridesDb(h).insertMany([
        ...farIds.map((_id, i) => ({ ...farTpl, _id, startsAt: at(3 * i) })),
        ...hiddenIds.map((_id, i) => ({
          ...hiddenTpl,
          _id,
          startsAt: at(3 * i + 1),
          geo: {
            type: 'Point' as const,
            coordinates: [hiddenGeo[0], hiddenGeo[1]] as [number, number],
          },
          startPrecise: true,
        })),
        ...plainIds.map((_id, i) => ({ ...plainTpl, _id, startsAt: at(40 + i) })),
      ]);
    };
    const get = async (url: string) => {
      const res = await authed(h, other, 'GET', url);
      expect(res.status).toBe(200);
      return res.body as { nextCursor?: string | null };
    };
    /** Полный обход «Рядом» по одному (путь предела пачек), страница 20 и карта — сырые ответы. */
    const responses = async () => {
      const bodies: unknown[] = [];
      let cursor: string | null | undefined = null;
      for (let page = 0; page < 15; page++) {
        const body = await get(`${RIDES}?${minsk}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        bodies.push(body);
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      expect(cursor).toBeNull();
      bodies.push(await get(`${RIDES}?${minsk}&limit=20`));
      bodies.push(await get(`${RIDES}/map?${minsk}`));
      return JSON.stringify(bodies);
    };

    await seed([27.56, 53.9]);
    const inside = await responses();
    await seed(CITY_CENTERS.borisov);
    const outside = await responses();
    expect(inside).toBe(outside);
    expect(ids(await feed(other, `${minsk}&limit=20`))).toEqual(plainIds);
  });

  it('документ старой формы (без geo, startPrecise, routeId) — в «Рядом» по городу и в withoutStart карты', async () => {
    const template = await stored((await createRide(h, organizer, {})).id);
    await ridesDb(h).deleteMany({});
    const id = uuidv7();
    const old: Partial<RideDoc> = { ...template, _id: id };
    delete old.geo;
    delete old.startPrecise;
    delete old.routeId;
    await ridesDb(h).insertOne(old as RideDoc);
    expect(ids(await feed(other, minsk))).toEqual([id]);
    expect(ids(await feed(other, borisov))).toEqual([]);
    expect(await mapOf(minsk)).toEqual({ items: [], withoutStart: 1 });
    expect(await mapOf(borisov)).toEqual({ items: [], withoutStart: 0 });
    expect(await mapOf()).toEqual({ items: [], withoutStart: 1 });
  });

  it('карта: недоступные маршруты раньше доступных — пачки до 200 видимых точек', async () => {
    const withdrawn = await seedApprovedRoute(h, other.userId, [27.62, 53.96]);
    const team = await seedTeamRoute(h, TEAM_START);
    const lostTemplate = await stored((await createRide(h, organizer, { routeId: withdrawn })).id);
    const keptTemplate = await stored((await createRide(h, organizer, { routeId: team })).id);
    await withdrawPublication(h, other.token, withdrawn);
    await ridesDb(h).deleteMany({});
    const at = (i: number) => new Date(h.clock.now().getTime() + DAY + i * MINUTE);
    await ridesDb(h).insertMany([
      ...Array.from({ length: 250 }, (_, i) => ({
        ...lostTemplate,
        _id: uuidv7(),
        startsAt: at(i),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        ...keptTemplate,
        _id: uuidv7(),
        startsAt: at(300 + i),
      })),
    ]);
    const map = await mapOf();
    expect(map.items).toHaveLength(3);
    expect(map.items.every((item) => item.start[0] === TEAM_START[0])).toBe(true);
    expect(map.withoutStart).toBe(250);
  });
});

describe('публичная карточка: поля ответа', () => {
  it('явный список ключей: + route и start, без geo, startPrecise, routeId', async () => {
    const routeId = await seedTeamRoute(h, TEAM_START);
    const ride = await createRide(h, organizer, { routeId });
    const res = await publicGet(`${RIDES}/${ride.id}`);
    expect(Object.keys(res.body as object).sort()).toEqual(
      [
        'id',
        'title',
        'organizerName',
        'startsAt',
        'city',
        'place',
        'distanceKm',
        'paceMinKmh',
        'paceMaxKmh',
        'limit',
        'goingCount',
        'full',
        'phase',
        'cancelReason',
        'rescheduledAt',
        'route',
        'start',
        'description',
      ].sort(),
    );
    expect(Object.keys((res.body as { route: object }).route).sort()).toEqual([
      'access',
      'distanceM',
      'elevationGainM',
      'id',
      'title',
    ]);
  });
});

describe('стирание аккаунта (ADR-0015, RC-1)', () => {
  it('точки райдов других организаторов на маршрутах удаляемого — центр города; повтор — без изменений', async () => {
    const routeId = await seedApprovedRoute(h, other.userId, [27.62, 53.96]);
    const ride = await createRide(h, organizer, { routeId, cityCode: 'borisov' });
    const erasure = h.app.get(RideErasure, { strict: false });
    const first = await erasure.erase(other.userId, h.clock.now());
    expect(first.restarted).toBe(1);
    expect(await stored(ride.id)).toMatchObject({
      routeId,
      geo: point(CITY_CENTERS.borisov),
      startPrecise: false,
      version: 0,
    });
    const before = await stored(ride.id);
    expect((await erasure.erase(other.userId, h.clock.now())).restarted).toBe(0);
    expect(await stored(ride.id)).toEqual(before);
  });
});

describe('порт RideRoutes (routes)', () => {
  const port = () => h.app.get<RideRoutes>(RIDE_ROUTES, { strict: false });

  it('visible без владельца — только каталог; подставленный catalog без approved — нет; чужой pending — не attachable', async () => {
    const forged = await seedRiderRoute(h, other.userId, {
      publication: publicationDoc(h, 'pending'),
      catalog: { city: 'minsk', surfaces: ['asphalt'], publishedAt: h.clock.now() },
    });
    const team = await seedTeamRoute(h);
    const visible = await port().visible([forged, team, team], null);
    expect([...visible.keys()]).toEqual([team]);
    expect((await port().visible([forged], other.userId)).get(forged)?.access).toBe('private');
    expect(await port().attachable(forged, organizer.userId)).toBeNull();
    expect(await port().visible([], null)).toEqual(new Map());
  });

  it('publicStartsWithin: только маршруты в каталоге со стартом в круге', async () => {
    const inside = await seedTeamRoute(h, TEAM_START);
    const outside = await seedTeamRoute(h, [28.2, 53.9], 'Далеко');
    const approved = await seedApprovedRoute(h, other.userId, [27.62, 53.96]);
    const withdrawn = await seedApprovedRoute(h, other.userId, [27.6, 53.92]);
    await withdrawPublication(h, other.token, withdrawn);
    const own = await seedRiderRoute(h, other.userId);
    const found = await port().publicStartsWithin([27.56, 53.9], 25);
    expect(new Set(found)).toEqual(new Set([inside, approved]));
    expect(found).not.toContain(outside);
    expect(found).not.toContain(own);
  });

  it('без кэша: снятие с публикации видно следующим вызовом', async () => {
    const routeId = await seedApprovedRoute(h, other.userId);
    expect((await port().visible([routeId], null)).has(routeId)).toBe(true);
    await withdrawPublication(h, other.token, routeId);
    expect((await port().visible([routeId], null)).has(routeId)).toBe(false);
    expect(await port().ownedRouteIds(other.userId)).toEqual([routeId]);
  });
});
