import { RiderRideHistoryPage } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, HOUR, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import {
  authed,
  createRide,
  hideInDb,
  join,
  leave,
  rider,
  type Rider,
  ridesDb,
} from '../../../test/rides';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const HISTORY = '/v1/profile/rides';

async function history(who: Rider, query = '') {
  const res = await authed(h, who, 'GET', `${HISTORY}${query}`);
  if (res.status !== 200) throw new Error(`история: ${res.status} ${JSON.stringify(res.body)}`);
  expect(res.headers['cache-control']).toBe('no-store');
  return RiderRideHistoryPage.parse(res.body);
}

/** Сдвинуть старт райда в прошлое (подготовка: создать райд в прошлом API не даёт). */
const startedAgo = (id: string, ms: number) =>
  ridesDb(h).updateOne({ _id: id }, { $set: { startsAt: new Date(h.clock.now().getTime() - ms) } });

describe('GET /v1/profile/rides (AC8)', () => {
  it('прошедшие с «Иду» и организацией; отменённые, скрытые, будущие, чужие и покинутые — нет; роль; курсор', async () => {
    const me = await rider(h, 'me@example.com');
    const other = await rider(h, 'other@example.com');
    // третий организатор — квота будущих райдов (5) у одного не помещает весь набор
    const third = await rider(h, 'third@example.com');

    const organized = await createRide(h, me, { title: 'Мой райд', distanceKm: 55 });
    const joined = await createRide(h, other, { title: 'Чужой с «Иду»' });
    const cancelled = await createRide(h, other, { title: 'Отменённый' });
    const hidden = await createRide(h, other, { title: 'Скрытый' });
    const future = await createRide(h, other, { title: 'Будущий' });
    const foreign = await createRide(h, third, { title: 'Без меня' });
    const left = await createRide(h, third, { title: 'Покинутый' });
    for (const ride of [joined, cancelled, hidden, future, left]) {
      expect((await join(h, me, ride.id)).status).toBe(200);
    }
    expect((await leave(h, me, left.id)).status).toBe(200);

    await startedAgo(organized.id, 2 * DAY);
    await startedAgo(joined.id, 3 * DAY);
    await startedAgo(cancelled.id, 4 * DAY);
    await startedAgo(hidden.id, 5 * DAY);
    await startedAgo(foreign.id, 6 * DAY);
    await startedAgo(left.id, HOUR);
    await ridesDb(h).updateOne({ _id: cancelled.id }, { $set: { status: 'cancelled' } });
    await hideInDb(h, hidden.id);

    const page = await history(me);
    expect(page.items).toEqual([
      {
        id: organized.id,
        title: 'Мой райд',
        startsAt: expect.any(String),
        distanceKm: 55,
        role: 'organizer',
      },
      {
        id: joined.id,
        title: 'Чужой с «Иду»',
        startsAt: expect.any(String),
        distanceKm: 42,
        role: 'participant',
      },
    ]);
    expect(page.nextCursor).toBeNull();
    // явный список полей: без организатора, участников, места
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
      ['distanceKm', 'id', 'role', 'startsAt', 'title'].sort(),
    );

    const first = await history(me, '?limit=1');
    expect(first.items.map((item) => item.id)).toEqual([organized.id]);
    const second = await history(me, `?limit=1&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.id)).toEqual([joined.id]);
    expect(second.nextCursor).toBeNull();

    // организаторы — свои прошедшие
    expect((await history(other)).items.map((item) => [item.id, item.role])).toEqual([
      [joined.id, 'organizer'],
    ]);
    expect((await history(third)).items.map((item) => item.id)).toEqual([left.id, foreign.id]);
  });

  it('мусорный курсор — 400; без входа — 401', async () => {
    const me = await rider(h, 'me@example.com');
    expect((await authed(h, me, 'GET', `${HISTORY}?cursor=abc`)).status).toBe(400);
    expect((await call(h, 'GET', HISTORY)).status).toBe(401);
  });
});
