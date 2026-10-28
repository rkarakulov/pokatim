import { MyRaceEntry, RiderRaceHistoryPage } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelSession } from '../../../test/panel';
import { publishedRace } from '../../../test/races';
import {
  CORRIDOR,
  corridorRace,
  enterRace,
  myEntry,
  protocolAction,
  resultsDb,
  rider,
  seedBest,
  signIn,
  travelTo,
  UPLOAD_CLOSES,
  withdraw,
} from '../../../test/results';

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

const HISTORY = '/v1/profile/races';

async function history(auth: Record<string, string>, query = '') {
  const res = await call(h, 'GET', `${HISTORY}${query}`, undefined, auth);
  if (res.status !== 200) throw new Error(`история: ${res.status} ${JSON.stringify(res.body)}`);
  expect(res.headers['cache-control']).toBe('no-store');
  return RiderRaceHistoryPage.parse(res.body);
}

const entryId = async (auth: Record<string, string>, raceId: string) =>
  MyRaceEntry.parse((await enterRace(h, auth, raceId)).body).entry!.id;

/** Результат истории в форме «моего участия» (без группы и числа строк). */
const sameAsEntry = (entry: MyRaceEntry) => ({
  status: entry.result.status,
  place: entry.result.place,
  tied: entry.result.tied,
  elapsedSec: entry.result.elapsedSec,
  unranked: entry.result.unranked,
});

/**
 * Три гонки: A (окно 24–26.10, с протоколом в конце), B (27–29.10, позже A), C (23.10, участие отменено). Заявки
 * райдера — в порядке B, C, A (обратном дате гонки для A и B).
 */
async function world() {
  const { admin, routeId, raceId: raceA } = await corridorRace(h);
  const corridor = { distanceKm: undefined, corridor: { routeId, widthM: CORRIDOR.widthM } };
  const raceB = (
    await publishedRace(
      h,
      admin.token,
      { ...corridor, title: 'Поздняя' },
      { start: '2026-10-27T00:00', end: '2026-10-29T23:59', protocol: '2026-10-31T23:59' },
    )
  ).id;
  const raceC = (
    await publishedRace(
      h,
      admin.token,
      { ...corridor, title: 'Ранняя' },
      { start: '2026-10-23T00:00', end: '2026-10-23T23:59', protocol: '2026-10-25T23:59' },
    )
  ).id;
  const me = await rider(h, 'rider0@example.com');
  const other = await rider(h, 'rider1@example.com');
  await entryId(me.auth, raceB);
  await entryId(me.auth, raceC);
  expect((await withdraw(h, me.auth, raceC)).status).toBe(200);
  const mine = await entryId(me.auth, raceA);
  const theirs = await entryId(other.auth, raceA);
  await seedBest(h, mine, 3700, new Date('2026-10-25T01:00:00Z'));
  await seedBest(h, theirs, 3600, new Date('2026-10-25T02:00:00Z'));
  return { admin, raceA, raceB, raceC, me, other };
}

describe('GET /v1/profile/races (AC7)', () => {
  it('свои заявки без снятых, по убыванию даты гонки; результат = «моё участие»', async () => {
    const w = await world();
    const page = await history(w.me.auth);
    expect(page.items.map((item) => item.race.id)).toEqual([w.raceB, w.raceA]);
    expect(page.nextCursor).toBeNull();
    const [later, earlier] = page.items;
    expect(later).toMatchObject({
      race: { title: 'Поздняя', status: 'published' },
      result: { status: 'none', place: null },
      // новая гонка без схемы: первая заявка без тела — START в схеме gender_age
      groupKey: 'overall',
      tier: 'start',
    });
    expect(earlier).toMatchObject({ groupKey: 'overall', tier: 'verified' });
    expect(earlier?.result).toEqual(sameAsEntry(await myEntry(h, w.me.auth, w.raceA)));
    expect(earlier?.result).toMatchObject({ place: 2, elapsedSec: 3700 });
    // чужая история — своя
    expect((await history(w.other.auth)).items.map((item) => item.race.id)).toEqual([w.raceA]);
  });

  it('курсор: по одной, без повторов и пропусков; мусор — 400; без входа — 401', async () => {
    const w = await world();
    const first = await history(w.me.auth, '?limit=1');
    expect(first.items.map((item) => item.race.id)).toEqual([w.raceB]);
    expect(first.nextCursor).not.toBeNull();
    const second = await history(w.me.auth, `?limit=1&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.race.id)).toEqual([w.raceA]);
    expect(second.nextCursor).toBeNull();
    const bad = await call(h, 'GET', `${HISTORY}?cursor=xyz`, undefined, w.me.auth);
    expect(bad.status).toBe(400);
    expect((await call(h, 'GET', `${HISTORY}?limit=21`, undefined, w.me.auth)).status).toBe(400);
    expect((await call(h, 'GET', HISTORY)).status).toBe(401);
  });

  it('после публикации протокола — место и статус из снимка, как у «моего участия»', async () => {
    const w = await world();
    travelTo(h, UPLOAD_CLOSES);
    const token = await panelSession(h, 'admin@example.by');
    const published = await protocolAction(h, token, w.raceA, '/protocol', { reason: 'Итоги' });
    expect(published.status).toBe(200);
    const auth = await signIn(h, w.me.email);
    const item = (await history(auth)).items.find((entry) => entry.race.id === w.raceA);
    expect(item?.result).toEqual(sameAsEntry(await myEntry(h, auth, w.raceA)));
    expect(item?.result).toMatchObject({ status: 'final', place: 2 });
  });

  it('заявка без raceWindowStartsAt (до 0033) — в конце, без падения', async () => {
    const w = await world();
    await resultsDb(h).entries.updateOne(
      { raceId: w.raceB, userId: w.me.userId },
      { $unset: { raceWindowStartsAt: '' } },
    );
    expect((await history(w.me.auth)).items.map((item) => item.race.id)).toEqual([
      w.raceA,
      w.raceB,
    ]);
  });
});
