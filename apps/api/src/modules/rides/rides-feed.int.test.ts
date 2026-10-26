import { RideCities, RideDetail, RidePage, RideView } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness, HOUR, MINUTE } from '../../../test/harness';
import { call } from '../../../test/identity';
import {
  authed,
  createRide,
  join,
  RIDES,
  rider,
  ridesDb,
  startsIn,
  type Rider,
} from '../../../test/rides';

/**
 * Чтение кофе-райдов (AC2, AC5–AC7, AC-T3, AC-T4): лента (порядок, курсор, город, только будущие, отменённые —
 * только своим, роль зрителя), города, публичная карточка (кэш, `public-read`, без служебных полей), `me`.
 */
let h: Harness;
let organizer: Rider;
let viewer: Rider;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
  organizer = await rider(h, 'org@example.by');
  viewer = await rider(h, 'viewer@example.by');
});
afterAll(async () => {
  await h.close();
});

let ipCounter = 0;
const publicGet = (url: string, ip = `203.0.113.${(ipCounter++ % 200) + 1}`) =>
  call(h, 'GET', url, undefined, { 'x-forwarded-for': ip });

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

const FORBIDDEN_KEYS = ['organizerUserId', 'participants', 'userId', 'createdAt', 'email'];

describe('лента', () => {
  it('будущие по времени старта, курсор по (startsAt, _id); прошедших нет; no-store', async () => {
    const later = await createRide(h, organizer, {
      startsAt: startsIn(h, 3 * DAY),
      title: 'Третий',
    });
    const first = await createRide(h, organizer, { startsAt: startsIn(h, DAY), title: 'Первый' });
    const sameTimeA = await createRide(h, viewer, { startsAt: startsIn(h, 2 * DAY) });
    const sameTimeB = await createRide(h, viewer, { startsAt: startsIn(h, 2 * DAY) });
    const past = await createRide(h, organizer);
    await ridesDb(h).updateOne(
      { _id: past.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - MINUTE) } },
    );

    const page1 = await authed(h, viewer, 'GET', `${RIDES}?limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.headers['cache-control']).toBe('no-store');
    const parsed1 = RidePage.parse(page1.body);
    const [b1, b2] = [sameTimeA.id, sameTimeB.id].sort();
    expect(parsed1.items.map((item) => item.id)).toEqual([first.id, b1]);
    const page2 = RidePage.parse(
      (await authed(h, viewer, 'GET', `${RIDES}?limit=2&cursor=${parsed1.nextCursor}`)).body,
    );
    expect(page2.items.map((item) => item.id)).toEqual([b2, later.id]);
    expect(page2.nextCursor).toBeNull();
  });

  it('роль зрителя в каждой карточке; без чужих id и служебных полей (AC-T3)', async () => {
    const own = await createRide(h, viewer);
    const joined = await createRide(h, organizer, { startsAt: startsIn(h, 2 * DAY) });
    const other = await createRide(h, organizer, { startsAt: startsIn(h, 3 * DAY), limit: 2 });
    await join(h, viewer, joined.id);
    await join(h, await rider(h, 'x@example.by'), other.id);

    const res = await authed(h, viewer, 'GET', RIDES);
    const page = RidePage.parse(res.body);
    expect(page.items.map((item) => [item.id, item.viewer.role, item.full])).toEqual([
      [own.id, 'organizer', false],
      [joined.id, 'participant', false],
      [other.id, 'none', true],
    ]);
    expect(page.items[2]!.viewer.canJoin).toBe(false);
    const keys = keysOf(res.body);
    for (const key of [...FORBIDDEN_KEYS, 'version']) expect(keys).not.toContain(key);
    const text = JSON.stringify(res.body);
    for (const id of [organizer.userId, viewer.userId]) expect(text).not.toContain(id);
  });

  it('отменённый будущий — только участникам и организатору (Q11, AC5)', async () => {
    const ride = await createRide(h, organizer);
    await join(h, viewer, ride.id);
    await authed(h, organizer, 'POST', `${RIDES}/${ride.id}/cancel`, { reason: 'weather' });
    const stranger = await rider(h, 'stranger@example.by');

    for (const who of [organizer, viewer]) {
      const items = RidePage.parse((await authed(h, who, 'GET', RIDES)).body).items;
      expect(items.map((item) => [item.id, item.phase, item.cancelReason])).toEqual([
        [ride.id, 'cancelled', 'weather'],
      ]);
    }
    expect(RidePage.parse((await authed(h, stranger, 'GET', RIDES)).body).items).toEqual([]);
  });

  it('фильтр города (ИЛИ), города ленты — только видимые зрителю будущие', async () => {
    const minsk = await createRide(h, organizer, { cityCode: 'minsk' });
    const brest = await createRide(h, organizer, {
      cityCode: 'brest',
      startsAt: startsIn(h, 2 * DAY),
    });
    await createRide(h, organizer, { cityCode: 'gomel', startsAt: startsIn(h, 3 * DAY) });
    const cancelledGrodno = await createRide(h, organizer, { cityCode: 'grodno' });
    await authed(h, organizer, 'POST', `${RIDES}/${cancelledGrodno.id}/cancel`, {
      reason: 'other',
    });

    const filtered = RidePage.parse(
      (await authed(h, viewer, 'GET', `${RIDES}?city=minsk&city=brest`)).body,
    );
    expect(filtered.items.map((item) => item.id)).toEqual([minsk.id, brest.id]);
    expect((await authed(h, viewer, 'GET', `${RIDES}?city=atlantis`)).status).toBe(400);

    const cities = await authed(h, viewer, 'GET', `${RIDES}/cities`);
    expect(cities.headers['cache-control']).toBe('no-store');
    expect(RideCities.parse(cities.body).cities.sort()).toEqual(['brest', 'gomel', 'minsk']);
    const own = RideCities.parse((await authed(h, organizer, 'GET', `${RIDES}/cities`)).body);
    expect(own.cities.sort()).toEqual(['brest', 'gomel', 'grodno', 'minsk']);
  });

  it('без входа: лента, города, me — 401; /rides/cities не уходит в pipe Uuid (AC-T4)', async () => {
    const ride = await createRide(h, organizer);
    expect((await publicGet(RIDES)).status).toBe(401);
    expect((await publicGet(`${RIDES}/cities`)).status).toBe(401);
    expect((await publicGet(`${RIDES}/${ride.id}/me`)).status).toBe(401);
    expect((await authed(h, viewer, 'GET', `${RIDES}/cities`)).status).toBe(200);
  });

  it('мусорный курсор — 400 на поле cursor', async () => {
    const res = await authed(h, viewer, 'GET', `${RIDES}?cursor=%7B%24ne%3A1%7D`);
    expect(res.status).toBe(400);
  });
});

describe('публичная карточка', () => {
  it('опубликованный: публичный кэш, без организатора, участников, version (AC-T3, AC-T4)', async () => {
    const ride = await createRide(h, organizer, { organizerName: 'Катя Л.' });
    await join(h, viewer, ride.id);
    const res = await publicGet(`${RIDES}/${ride.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const detail = RideDetail.parse(res.body);
    expect(detail).toMatchObject({
      goingCount: 2,
      phase: 'upcoming',
      organizerName: 'Катя Л.',
      description: 'Едем спокойно',
    });
    const keys = keysOf(res.body);
    for (const key of [...FORBIDDEN_KEYS, 'version', 'viewer']) expect(keys).not.toContain(key);
    const text = JSON.stringify(res.body);
    for (const id of [organizer.userId, viewer.userId]) expect(text).not.toContain(id);
  });

  it('отменённый и прошедший — доступны по ссылке с фазой; неизвестный — 404, не uuid — 400', async () => {
    const cancelled = await createRide(h, organizer);
    await authed(h, organizer, 'POST', `${RIDES}/${cancelled.id}/cancel`, {
      reason: 'road_conditions',
    });
    expect(RideDetail.parse((await publicGet(`${RIDES}/${cancelled.id}`)).body)).toMatchObject({
      phase: 'cancelled',
      cancelReason: 'road_conditions',
    });
    const past = await createRide(h, organizer);
    await ridesDb(h).updateOne(
      { _id: past.id },
      { $set: { startsAt: new Date(h.clock.now().getTime() - HOUR) } },
    );
    expect(RideDetail.parse((await publicGet(`${RIDES}/${past.id}`)).body).phase).toBe('past');
    expect((await publicGet(`${RIDES}/01890a5d-ac96-774b-bcce-b302099a8057`)).status).toBe(404);
    expect((await publicGet(`${RIDES}/not-a-uuid`)).status).toBe(400);
  });

  it('IP-лимит public-read: 429 + Retry-After', async () => {
    const ride = await createRide(h, organizer);
    const ip = '198.51.100.77';
    let last = await publicGet(`${RIDES}/${ride.id}`, ip);
    for (let i = 0; i < 300 && last.status === 200; i++)
      last = await publicGet(`${RIDES}/${ride.id}`, ip);
    expect(last.status).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
  });
});

describe('me', () => {
  it('гость в ленте: роль none; участник — без version; организатор — с version; no-store', async () => {
    const ride = await createRide(h, organizer);
    const asStranger = await authed(h, viewer, 'GET', `${RIDES}/${ride.id}/me`);
    expect(asStranger.headers['cache-control']).toBe('no-store');
    expect(RideView.parse(asStranger.body).viewer).toEqual({
      role: 'none',
      canJoin: true,
      canLeave: false,
      canManage: false,
      reported: false,
      canReport: true,
    });
    expect(keysOf(asStranger.body)).not.toContain('version');
    await join(h, viewer, ride.id);
    const asParticipant = RideView.parse(
      (await authed(h, viewer, 'GET', `${RIDES}/${ride.id}/me`)).body,
    );
    expect(asParticipant.viewer.role).toBe('participant');
    const asOrganizer = await authed(h, organizer, 'GET', `${RIDES}/${ride.id}/me`);
    expect(RideView.parse(asOrganizer.body).ride).toHaveProperty('version', 0);
    for (const key of FORBIDDEN_KEYS) expect(keysOf(asOrganizer.body)).not.toContain(key);
    expect(JSON.stringify(asOrganizer.body)).not.toContain(viewer.userId);
    expect(
      (await authed(h, viewer, 'GET', `${RIDES}/01890a5d-ac96-774b-bcce-b302099a8057/me`)).status,
    ).toBe(404);
  });
});
