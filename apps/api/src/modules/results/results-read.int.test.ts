import { MyRaceEntry, PanelRaceStandings, RaceResultsPage } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, gate } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { createRace, publishedRace, RACES, staff } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  myEntry,
  protocolAction,
  protocolRace,
  resultsDb,
  rider,
  signIn,
  withdraw,
} from '../../../test/results';
import { ResultsRepository } from './results.repository';

/**
 * Таблица и чтение (race-results-03: AC18, AC19, AC21, AC22): места при чтении «1, =2, =2, 4», граница страниц,
 * отмена участия, ответ без ПДн, кэш, панель — права и видимость.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterAll(async () => {
  await h.close();
});

const results = (raceId: string, query = '') =>
  call(h, 'GET', `/v1/races/${raceId}/results${query}`);
const page = (body: unknown) => RaceResultsPage.parse(body);

/** Лучший результат заявки — в БД (подготовка: проверки идут в results-check). */
async function seedBest(entryId: string, elapsedSec: number, startedAt: string) {
  const at = new Date(startedAt);
  await resultsDb(h).entries.updateOne(
    { _id: entryId },
    {
      $set: {
        best: {
          attemptId: entryId,
          elapsedSec,
          startedAt: at,
          finishedAt: new Date(at.getTime() + elapsedSec * 1000),
          // race-results-07: заявки гонки `overall` — место без правила пульса (как после бэкфилла 0025)
          ranked: true,
          flags: [],
        },
        summary: { total: 1, pending: 0, counted: 1, rejectedShown: 0, failed: 0, excluded: 0 },
      },
    },
  );
}

/** Гонка и райдеры с заявками и лучшими временами (по порядку email). */
async function standings(times: readonly (number | null)[]) {
  const race = await corridorRace(h);
  const riders = [];
  for (const [index, elapsed] of times.entries()) {
    const r = await rider(h, `rider${index}@example.com`);
    const entry = MyRaceEntry.parse((await enterRace(h, r.auth, race.raceId)).body).entry!;
    if (elapsed !== null) await seedBest(entry.id, elapsed, `2026-10-25T0${index}:00:00Z`);
    riders.push({ ...r, entryId: entry.id });
  }
  return { ...race, riders };
}

describe('предварительная таблица (AC18, AC21)', () => {
  it('3600, 3700, 3700, 3800 → «1, =2, =2, 4»; без засчитанных — без строки; ответ без ПДн; кэш 60 с', async () => {
    const { raceId, riders } = await standings([3700, 3600, 3800, 3700, null]);
    const res = await results(raceId);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const body = page(res.body);
    expect(body).toMatchObject({ group: 'overall', status: 'provisional', ranked: 4, entries: 5 });
    expect(body.items.map((row) => [row.entryId, row.place, row.tied, row.elapsedSec])).toEqual([
      [riders[1]!.entryId, 1, false, 3600],
      [riders[0]!.entryId, 2, true, 3700],
      [riders[3]!.entryId, 2, true, 3700],
      [riders[2]!.entryId, 4, false, 3800],
    ]);
    // ключи ответа — без userId, активности, времени суток, координат
    expect(Object.keys(res.body as object).sort()).toEqual(
      // race-results-07: вкладки групп и число финишёров
      ['entries', 'finishers', 'group', 'groups', 'items', 'nextCursor', 'ranked', 'status'].sort(),
    );
    for (const row of (res.body as { items: object[] }).items) {
      expect(Object.keys(row).sort()).toEqual([
        'elapsedSec',
        'entryId',
        'place',
        'riderName',
        'tied',
      ]);
    }
    // своё место — в «моём участии»
    expect((await myEntry(h, riders[3]!.auth, raceId)).result).toMatchObject({
      status: 'provisional',
      place: 2,
      tied: true,
      ranked: 4,
      elapsedSec: 3700,
    });
  });

  it('ничья на границе страниц (limit 2) сохраняет место и «=»; курсор ведёт дальше', async () => {
    const { raceId } = await standings([3600, 3700, 3700, 3800]);
    const first = page((await results(raceId, '?limit=2')).body);
    expect(first.items.map((row) => [row.place, row.tied])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = page(
      (await results(raceId, `?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)).body,
    );
    expect(second.items.map((row) => [row.place, row.tied, row.elapsedSec])).toEqual([
      [2, true, 3700],
      [4, false, 3800],
    ]);
    expect(second.nextCursor).toBeNull();
    expect((await results(raceId, '?cursor=garbage')).status).toBe(400);
    expect((await results(raceId, '?limit=101')).status).toBe(400);
    expect((await results(raceId, '?userId=x')).status).toBe(400);
  });

  it('курсор не раскрывает время старта: только строка таблицы; строка выбыла — 400 cursor', async () => {
    const { raceId, riders, admin, routeId } = await standings([3600, 3700, 3800]);
    const first = page((await results(raceId, '?limit=1')).body);
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8')) as {
      k: string;
      id: string;
    };
    expect(decoded).toEqual({ k: 'e', id: riders[0]!.entryId });
    const startedAt = new Date('2026-10-25T00:00:00Z');
    expect(first.nextCursor).not.toContain(String(startedAt.getTime()));
    const second = page(
      (await results(raceId, `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).body,
    );
    expect(second.items.map((row) => [row.entryId, row.place])).toEqual([[riders[1]!.entryId, 2]]);
    // строка курсора выбыла из таблицы (отмена участия) — клиент начинает сначала
    expect((await withdraw(h, riders[0]!.auth, raceId)).status).toBe(200);
    const stale = await results(raceId, `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(stale.status).toBe(400);
    // курсор строки другой гонки — тоже 400
    const other = await publishedRace(h, admin.token, {
      title: 'Другая гонка',
      distanceKm: undefined,
      corridor: { routeId, widthM: 50 },
    });
    expect(
      (await results(other.id, `?limit=1&cursor=${encodeURIComponent(second.nextCursor!)}`)).status,
    ).toBe(400);
  });

  it('отмена участия — строки нет, места остальных сдвинулись; попытки и результат райдера — withdrawn', async () => {
    const { raceId, riders } = await standings([3600, 3700, 3800]);
    expect((await withdraw(h, riders[0]!.auth, raceId)).status).toBe(200);
    const body = page((await results(raceId)).body);
    expect(body.items.map((row) => [row.entryId, row.place])).toEqual([
      [riders[1]!.entryId, 1],
      [riders[2]!.entryId, 2],
    ]);
    expect(body).toMatchObject({ ranked: 2, entries: 2 });
    expect((await myEntry(h, riders[0]!.auth, raceId)).result).toMatchObject({
      status: 'withdrawn',
      place: null,
      elapsedSec: null,
    });
    expect((await resultsDb(h).entries.findOne({ _id: riders[0]!.entryId }))?.best).not.toBeNull();
  });

  it('черновик и неизвестная гонка — 404; отменённая — пустая таблица', async () => {
    const { admin, raceId, version } = await standings([3600]);
    const draft = await createRace(h, admin.token, { title: 'Черновик' });
    expect((await results(draft.id)).status).toBe(404);
    expect((await results('01890a5d-ac96-774b-bcce-b302099a8057')).status).toBe(404);
    expect((await results('nope')).status).toBe(400);
    await panelCall(h, admin.token, 'POST', `${RACES}/${raceId}/cancel`, {
      version,
      reason: 'weather',
    });
    expect(page((await results(raceId)).body)).toMatchObject({ ranked: 0, items: [] });
  });
});

describe('моё участие — один снимок БД (ревью Codex)', () => {
  /**
   * Заявка, попытки и место читаются в одной snapshot-сессии: лучший результат сняли между чтениями (ворота перед
   * подсчётом строк) — ответ согласован со снимком (место и число строк из одного состояния), не «место 1 из 0».
   */
  it('снятие лучшего между чтениями не даёт место при ranked = 0', async () => {
    const { raceId, riders } = await standings([3600]);
    const repository = h.app.get(ResultsRepository, { strict: false });
    const g = gate();
    const countRanked = repository.countRanked.bind(repository);
    vi.spyOn(repository, 'countRanked').mockImplementationOnce(async (...args) => {
      await g.wait();
      return countRanked(...args);
    });
    const reading = myEntry(h, riders[0]!.auth, raceId);
    await g.reached;
    await resultsDb(h).entries.updateOne(
      { _id: riders[0]!.entryId },
      {
        $set: {
          best: null,
          summary: { total: 1, pending: 0, counted: 0, rejectedShown: 0, failed: 0, excluded: 0 },
        },
      },
    );
    g.open();
    const view = await reading;
    expect(view.result).toMatchObject({ status: 'provisional', place: 1, ranked: 1 });
  });
});

describe('панель (AC22)', () => {
  it('модератор — любая гонка; организатор — только свои (чужая 404); без сессии — 401; access приложения — 401', async () => {
    const { raceId } = await standings([3600]);
    const moderator = await staff(h, 'moderator@example.by', 'moderator');
    const organizer = await staff(h, 'org@example.by', 'organizer');
    const summary = await panelCall(h, moderator.token, 'GET', `${RACES}/${raceId}/results`);
    expect(summary.status).toBe(200);
    expect(summary.headers['cache-control']).toBe('no-store');
    expect(summary.body).toMatchObject({
      raceId,
      engineVersion: 1,
      counts: { entries: 1, active: 1, withdrawn: 0, ranked: 1, failed: 0, hidden: 0 },
    });
    expect(
      (await panelCall(h, moderator.token, 'GET', `${RACES}/${raceId}/attempts`)).body,
    ).toEqual({ items: [], nextCursor: null });
    expect((await panelCall(h, organizer.token, 'GET', `${RACES}/${raceId}/results`)).status).toBe(
      404,
    );
    expect((await panelCall(h, organizer.token, 'GET', `${RACES}/${raceId}/attempts`)).status).toBe(
      404,
    );
    expect((await call(h, 'GET', `/v1/admin/races/${raceId}/results`)).status).toBe(401);
    const app = await rider(h, 'app@example.com');
    expect(
      (await call(h, 'GET', `/v1/admin/races/${raceId}/results`, undefined, app.auth)).status,
    ).toBe(401);
    expect(
      (await panelCall(h, moderator.token, 'GET', `${RACES}/${raceId}/attempts?status=nope`))
        .status,
    ).toBe(400);
  });
});

describe('после публикации протокола (race-results-05: AC9, RC-5, §7.6)', () => {
  const encode = (entryId: string) =>
    encodeURIComponent(Buffer.from(JSON.stringify({ k: 'e', id: entryId })).toString('base64url'));

  it('таблица и «моё участие» — из текущей ревизии: final, DQ нет в таблице, у участника dq; курсор строки DQ — 400', async () => {
    const { raceId, riders, token } = await protocolRace(h, [3600, 3700, 3800, null]);
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    expect(page((await results(raceId)).body)).toMatchObject({
      status: 'final',
      ranked: 3,
      entries: 4,
    });
    expect(
      (
        await protocolAction(h, token, raceId, '/protocol/disqualify', {
          entryId: riders[0]!.entryId,
          reason: 'Срезка',
        })
      ).status,
    ).toBe(200);
    const body = page((await results(raceId)).body);
    expect(body).toMatchObject({ status: 'final', ranked: 2, entries: 4, nextCursor: null });
    expect(body.items.map((row) => [row.entryId, row.place, row.tied, row.elapsedSec])).toEqual([
      [riders[1]!.entryId, 1, false, 3700],
      [riders[2]!.entryId, 2, false, 3800],
    ]);
    const first = page((await results(raceId, '?limit=1')).body);
    expect(first.items.map((row) => row.entryId)).toEqual([riders[1]!.entryId]);
    const second = page(
      (await results(raceId, `?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).body,
    );
    expect(second.items.map((row) => row.entryId)).toEqual([riders[2]!.entryId]);
    expect((await results(raceId, `?cursor=${encode(riders[0]!.entryId)}`)).status).toBe(400);
    expect((await results(raceId, `?cursor=${encode(riders[3]!.entryId)}`)).status).toBe(400);

    const auth = await signIn(h, riders[0]!.email);
    expect((await myEntry(h, auth, raceId)).result).toMatchObject({
      status: 'dq',
      place: null,
      tied: false,
      elapsedSec: 3600,
      ranked: 2,
    });
    expect((await myEntry(h, await signIn(h, riders[1]!.email), raceId)).result).toMatchObject({
      status: 'revised',
      place: 1,
      elapsedSec: 3700,
    });
  });

  it('RC-5: заявка без строки протокола — без места и не provisional, даже с лучшим после снимка', async () => {
    const { raceId, riders, token } = await protocolRace(h, [3600, null]);
    expect((await protocolAction(h, token, raceId, '/protocol')).status).toBe(200);
    // остаточная гонка: лучший результат появился в заявке после снимка
    await seedBest(riders[1]!.entryId, 3500, '2026-10-25T05:00:00Z');
    const auth = await signIn(h, riders[1]!.email);
    expect((await myEntry(h, auth, raceId)).result).toMatchObject({
      status: 'dns',
      place: null,
      tied: false,
      elapsedSec: null,
      ranked: 1,
    });
    const standings = PanelRaceStandings.parse(
      (await panelCall(h, token, 'GET', `${RACES}/${raceId}/standings`)).body,
    );
    expect(standings).toMatchObject({ source: 'protocol', revision: 1, truncated: false });
    expect(
      standings.items.map((row) => [row.entryId, row.resultStatus, row.place, row.elapsedSec]),
    ).toEqual([
      [riders[0]!.entryId, 'final', 1, 3600],
      [riders[1]!.entryId, 'dns', null, null],
    ]);
  });

  it('«Участники» до публикации: строки с местами по таблице, затем прочие по времени заявки', async () => {
    const { raceId, riders, token } = await protocolRace(h, [3700, null, 3600, 3700]);
    const res = await panelCall(h, token, 'GET', `${RACES}/${raceId}/standings`);
    expect(res.status).toBe(200);
    const body = PanelRaceStandings.parse(res.body);
    expect(body).toMatchObject({ source: 'live', revision: null, truncated: false });
    expect(
      body.items.map((row) => [row.entryId, row.place, row.tied, row.resultStatus, row.userId]),
    ).toEqual([
      [riders[2]!.entryId, 1, false, 'provisional', riders[2]!.userId],
      [riders[0]!.entryId, 2, true, 'provisional', riders[0]!.userId],
      [riders[3]!.entryId, 2, true, 'provisional', riders[3]!.userId],
      [riders[1]!.entryId, null, false, 'dns', riders[1]!.userId],
    ]);
    expect(body.items[0]?.summary).toEqual({
      total: 1,
      pending: 0,
      counted: 1,
      rejectedShown: 0,
      failed: 0,
      excluded: 0,
    });
    const organizer = await staff(h, 'org@example.by', 'organizer');
    expect(
      (await panelCall(h, organizer.token, 'GET', `${RACES}/${raceId}/standings`)).status,
    ).toBe(404);
    expect(
      (await panelCall(h, organizer.token, 'GET', `${RACES}/${raceId}/protocol/recalculations`))
        .status,
    ).toBe(404);
  });
});
