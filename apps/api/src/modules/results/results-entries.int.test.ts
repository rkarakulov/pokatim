import { rm } from 'node:fs/promises';

import { MyRaceEntry, PanelRace } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, DAY, HOUR, type Harness } from '../../../test/harness';
import { call, gate, holdTransaction, retried, untilBlocked } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { createRace, publishedRace, RACES, racesDb, racesRepository } from '../../../test/races';
import {
  corridorRace,
  enterRace,
  entryUrl,
  myEntry,
  resultsDb,
  rider,
  signIn,
  travelTo,
  WINDOW,
  withdraw,
} from '../../../test/results';
import { TRACK_STORAGE_DIR_TEST } from '../../../test/test-env';
import { ResultsRepository } from './results.repository';

/**
 * Заявка и отмена участия, V-12 (race-results-03: AC1–AC4, AC20, AC23). Стенд: «сейчас» — 22.10.2026 12:00 Минска,
 * окно гонки — 24.10 00:00 — 26.10 23:59 (фаза `upcoming`).
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
  await rm(TRACK_STORAGE_DIR_TEST, { recursive: true, force: true });
});

const UNKNOWN_RACE = '01890a5d-ac96-774b-bcce-b302099a8057';
const code = (body: unknown) => (body as { code?: string }).code;
const reason = (body: unknown) => (body as { details?: { reason?: string } }).details?.reason;

describe('заявка (AC1)', () => {
  it('upcoming с коридором: 201 active, повтор — 200 та же заявка; races.lockedAt записан', async () => {
    const { raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    const first = await enterRace(h, auth, raceId);
    expect(first.status).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    const entry = MyRaceEntry.parse(first.body);
    expect(entry.entry).toMatchObject({ status: 'active', withdrawnAt: null });
    expect(entry.result).toMatchObject({ status: 'none', place: null, ranked: 0 });
    expect(entry.actions).toEqual({
      canEnter: false,
      canWithdraw: true,
      canAddAttempt: false,
      reasons: ['window_not_open'],
    });
    const again = await enterRace(h, auth, raceId);
    expect(again.status).toBe(200);
    expect(MyRaceEntry.parse(again.body).entry?.id).toBe(entry.entry?.id);
    expect(await resultsDb(h).entries.countDocuments()).toBe(1);
    expect((await racesDb(h).races.findOne({ _id: raceId }))?.lockedAt).toEqual(h.clock.now());
    const events = await h.db
      .collection('outbox')
      .find({ type: 'results.entry-created' })
      .toArray();
    expect(events.map((event) => event.payload)).toEqual([{ entryId: entry.entry?.id }]);
  });

  it('без коридора, окно закрыто, гонка отменена — 409 RACE_ENTRY_CLOSED с причиной; черновик и неизвестная — 404; без входа — 401', async () => {
    const { admin, raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    const plain = await publishedRace(h, admin.token, { title: 'Анонс' });
    const noCorridor = await enterRace(h, auth, plain.id);
    expect([noCorridor.status, code(noCorridor.body), reason(noCorridor.body)]).toEqual([
      409,
      'RACE_ENTRY_CLOSED',
      'no_corridor',
    ]);
    const draft = await createRace(h, admin.token, { title: 'Черновик' });
    expect((await enterRace(h, auth, draft.id)).status).toBe(404);
    expect((await enterRace(h, auth, UNKNOWN_RACE)).status).toBe(404);
    expect((await enterRace(h, auth, 'not-a-uuid')).status).toBe(400);
    expect((await call(h, 'POST', entryUrl(raceId), {})).status).toBe(401);
    expect((await call(h, 'POST', entryUrl(raceId), { userId: 'x' }, auth)).status).toBe(400);

    const cancelled = await publishedRace(h, admin.token, {
      title: 'Отменённая',
      distanceKm: undefined,
      corridor: {
        routeId: (await racesDb(h).races.findOne({ _id: raceId }))!.corridor!.routeId,
        widthM: 50,
      },
    });
    await panelCall(h, admin.token, 'POST', `${RACES}/${cancelled.id}/cancel`, {
      version: cancelled.version,
      reason: 'weather',
    });
    const onCancelled = await enterRace(h, auth, cancelled.id);
    expect([onCancelled.status, reason(onCancelled.body)]).toEqual([409, 'cancelled']);

    travelTo(h, new Date(WINDOW.closesAt.getTime() + HOUR));
    const late = await enterRace(h, await signIn(h, 'rider@example.com'), raceId);
    expect([late.status, reason(late.body)]).toEqual([409, 'entries_closed']);
    expect(await resultsDb(h).entries.countDocuments()).toBe(0);
  });

  it('две одновременные заявки одного райдера — одна заявка (201 и 200)', async () => {
    const { raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    const results = await Promise.all([enterRace(h, auth, raceId), enterRace(h, auth, raceId)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 201]);
    expect(await resultsDb(h).entries.countDocuments()).toBe(1);
  });

  it('без заявки: GET entry — entry null, canEnter, uploadClosesAt = закрытие окна + 24 ч', async () => {
    const { raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    const view = await myEntry(h, auth, raceId);
    expect(view).toMatchObject({
      raceId,
      entry: null,
      attempts: [],
      pendingUploads: [],
      uploadClosesAt: new Date(WINDOW.closesAt.getTime() + DAY).toISOString(),
      actions: {
        canEnter: true,
        canWithdraw: false,
        canAddAttempt: false,
        reasons: ['not_entered'],
      },
    });
  });
});

describe('V-12 и гонки записи в документ гонки (AC2, AC3)', () => {
  it('после первой заявки панель видит entries_locked; коридор — FIELD_LOCKED', async () => {
    const { admin, raceId, routeId } = await corridorRace(h);
    const { auth } = await rider(h);
    expect((await enterRace(h, auth, raceId)).status).toBe(201);
    const race = PanelRace.parse(
      (await panelCall(h, admin.token, 'GET', `${RACES}/${raceId}`)).body,
    );
    expect(race.editable.reasons).toContain('entries_locked');
    const edit = await panelCall(h, admin.token, 'POST', `${RACES}/${raceId}`, {
      version: race.version,
      corridor: { routeId, widthM: 100 },
    });
    expect(edit.status).toBe(400);
  });

  /**
   * Первая заявка ↔ смена коридора панелью: заявка остановлена после `admitEntry` (ворота), правка повторяется на
   * конфликте записи и после коммита заявки видит `lockedAt` — `FIELD_LOCKED`. Отрицательное доказательство:
   * `admitEntry` только читает — правка проходит, коридор сменился при существующей заявке.
   */
  it('заявка ↔ правка коридора: никогда «заявка есть, коридор сменился после неё»', async () => {
    const { admin, raceId, routeId, version } = await corridorRace(h);
    const { auth } = await rider(h);
    const results = h.app.get(ResultsRepository, { strict: false });
    const races = racesRepository(h);
    const g = gate();
    const findEntry = results.findEntry.bind(results);
    vi.spyOn(results, 'findEntry').mockImplementationOnce(async (...args) => {
      await g.wait();
      return findEntry(...args);
    });
    const updateSpy = vi.spyOn(races, 'updateRace');
    const entering = enterRace(h, auth, raceId);
    await g.reached;
    const editing = panelCall(h, admin.token, 'POST', `${RACES}/${raceId}`, {
      version,
      corridor: { routeId, widthM: 100 },
    });
    await untilBlocked(editing, retried(updateSpy));
    g.open();
    const [entered, edited] = await Promise.all([entering, editing]);
    expect(entered.status).toBe(201);
    expect(edited.status).toBe(400);
    expect((edited.body as { details: { fields: unknown[] } }).details.fields).toEqual([
      { path: 'corridor', code: 'FIELD_LOCKED' },
    ]);
    expect((await racesDb(h).races.findOne({ _id: raceId }))?.corridor?.widthM).toBe(50);
  });

  /**
   * Заявка ↔ отмена гонки: удерживаемая транзакция отмены записала статус, заявка конфликтует на записи `admitEntry`
   * и после коммита видит отмену — 409. Отрицательное доказательство: без записи — заявка на отменённой гонке.
   */
  it('заявка ↔ отмена гонки: заявки на отменённой гонке нет', async () => {
    const { raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    const races = racesRepository(h);
    const admitSpy = vi.spyOn(races, 'admitEntry');
    const hold = await holdTransaction(h, async (session) => {
      await racesDb(h).races.updateOne(
        { _id: raceId },
        { $set: { status: 'cancelled', cancelReason: 'weather', cancelledAt: h.clock.now() } },
        { session },
      );
    });
    const entering = enterRace(h, auth, raceId);
    await untilBlocked(entering, retried(admitSpy));
    await hold.commit();
    const entered = await entering;
    expect([entered.status, reason(entered.body)]).toEqual([409, 'cancelled']);
    expect(await resultsDb(h).entries.countDocuments()).toBe(0);
  });
});

describe('отмена участия (AC4)', () => {
  it('в upcoming/open — withdrawn, повтор 200; повторная заявка — 409 RACE_ENTRY_WITHDRAWN', async () => {
    const { raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    expect((await withdraw(h, auth, raceId)).status).toBe(409);
    await enterRace(h, auth, raceId);
    const res = await withdraw(h, auth, raceId);
    expect(res.status).toBe(200);
    const view = MyRaceEntry.parse(res.body);
    expect(view.entry).toMatchObject({
      status: 'withdrawn',
      withdrawnAt: h.clock.now().toISOString(),
    });
    expect(view.result.status).toBe('withdrawn');
    expect(view.actions).toEqual({
      canEnter: false,
      canWithdraw: false,
      canAddAttempt: false,
      reasons: ['withdrawn'],
    });
    expect((await withdraw(h, auth, raceId)).status).toBe(200);
    const again = await enterRace(h, auth, raceId);
    expect([again.status, code(again.body)]).toEqual([409, 'RACE_ENTRY_WITHDRAWN']);
  });

  it('после закрытия окна — 409 RACE_WITHDRAW_CLOSED', async () => {
    const { raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    await enterRace(h, auth, raceId);
    travelTo(h, WINDOW.closesAt);
    const res = await withdraw(h, await signIn(h, 'rider@example.com'), raceId);
    expect([res.status, code(res.body)]).toEqual([409, 'RACE_WITHDRAW_CLOSED']);
    expect((await resultsDb(h).entries.findOne())?.status).toBe('active');
  });
});

describe('лимиты (AC23)', () => {
  it('21-я заявка/отмена за час — 429; 31-я явная попытка за час — 429', async () => {
    const { raceId } = await corridorRace(h);
    const { auth } = await rider(h);
    for (let i = 0; i < 20; i += 1) expect((await enterRace(h, auth, raceId)).status).not.toBe(429);
    const limited = await withdraw(h, auth, raceId);
    expect([limited.status, code(limited.body)]).toEqual([429, 'RATE_LIMITED']);

    const body = { activityId: '01890a5d-ac96-774b-bcce-b302099a8057' };
    const url = `/v1/races/${raceId}/attempts`;
    for (let i = 0; i < 30; i += 1) {
      expect((await call(h, 'POST', url, body, auth)).status).not.toBe(429);
    }
    expect((await call(h, 'POST', url, body, auth)).status).toBe(429);
  });
});
