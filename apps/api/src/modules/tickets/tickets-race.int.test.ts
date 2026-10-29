import { MyTicketRef, MyTickets } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call, collections } from '../../../test/identity';
import { panelCall, panelSession } from '../../../test/panel';
import { racesDb } from '../../../test/races';
import { resultsDb, signIn, travelTo, withdraw } from '../../../test/results';
import {
  enableRaceTickets,
  enter,
  issuedEvents,
  raceTicket,
  raceWorld,
  reconcileAll,
  RACE_START,
  rider,
  ticketingUrl,
  ticketsDb,
} from '../../../test/tickets';

/**
 * Билеты гонок (AC1–AC3, RC-T4, RC-T5): выпуск сверкой — лениво при чтении и регламентом worker; одна заявка — один
 * билет и одно событие письма, параллельные выпуски ловит `tickets_registration_unique`.
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

describe('билет гонки по заявке (AC1)', () => {
  it('заявка + включённые билеты → один active; два параллельных GET и сверка — один билет, одно событие', async () => {
    const { admin, raceId } = await raceWorld(h);
    await enableRaceTickets(h, admin.token, raceId);
    const a = await rider(h, 'a@example.com');
    await enter(h, a.auth, raceId);

    const [first, second] = await Promise.all([
      raceTicket(h, a.auth, raceId),
      raceTicket(h, a.auth, raceId),
    ]);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const ref = MyTicketRef.parse(first.body);
    expect(ref).toMatchObject({ status: 'active', past: false });
    expect(ref.event).toMatchObject({
      kind: 'race',
      id: raceId,
      startsAt: '2026-10-24T07:00:00.000Z',
      place: 'Парк Победы',
    });
    expect(MyTicketRef.parse(second.body).code).toBe(ref.code);
    await reconcileAll(h);

    expect(await ticketsDb(h).tickets.countDocuments()).toBe(1);
    expect(await issuedEvents(h)).toHaveLength(1);
    const doc = await ticketsDb(h).tickets.findOne({});
    // в БД — только хэш QR, без токена
    expect(Object.keys(doc!).sort()).toEqual(
      [
        '_id',
        'code',
        'qrHash',
        'kind',
        'eventId',
        'registrationId',
        'userId',
        'category',
        'status',
        'checkedInAt',
        'checkedInBy',
        'cancelledAt',
        'email',
        'createdAt',
        'version',
      ].sort(),
    );
    const entry = await resultsDb(h).entries.findOne({ userId: a.userId });
    expect(doc!.category).toEqual({ kind: 'race', tier: entry!.tier, groupKey: entry!.groupKey });
  });

  it('нет заявки — null; нет гонки или черновик — 404; гость — 401', async () => {
    const { admin, raceId } = await raceWorld(h);
    await enableRaceTickets(h, admin.token, raceId);
    const a = await rider(h, 'a@example.com');
    const none = await raceTicket(h, a.auth, raceId);
    expect(none.status).toBe(200);
    expect(none.body).toBeNull();
    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'draft' } });
    expect((await raceTicket(h, a.auth, raceId)).status).toBe(404);
    expect((await raceTicket(h, {}, raceId)).status).toBe(401);
  });
});

describe('включение после заявок и сверка (AC2, RC-T1, RC-T4)', () => {
  it('без настроек — null; включение → сверка выпускает всем активным, удалённому — нет; события по числу', async () => {
    const { admin, raceId } = await raceWorld(h);
    const riders = [];
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) {
      const who = await rider(h, email);
      await enter(h, who.auth, raceId);
      riders.push(who);
    }
    const [a, , c, d] = riders;
    const off = await raceTicket(h, a!.auth, raceId);
    expect(off.body).toBeNull();
    expect((await withdraw(h, c!.auth, raceId)).status).toBe(200);
    // удалённый аккаунт (заявка остаётся псевдонимной) — билет не выпускается
    await collections(h).users.updateOne(
      { _id: d!.userId },
      { $set: { deletedAt: h.clock.now() } },
    );

    await enableRaceTickets(h, admin.token, raceId);
    expect(await reconcileAll(h)).toEqual({ races: 1, issued: 2, failed: 0 });
    expect(await ticketsDb(h).tickets.countDocuments()).toBe(2);
    expect(await issuedEvents(h)).toHaveLength(2);
    expect(
      await ticketsDb(h).tickets.countDocuments({ userId: { $in: [c!.userId, d!.userId] } }),
    ).toBe(0);

    // повтор сверки — без новых билетов и событий
    expect(await reconcileAll(h)).toEqual({ races: 1, issued: 0, failed: 0 });
    expect(await issuedEvents(h)).toHaveLength(2);
  });

  it('после закрытия окна check-in и у отменённой гонки — не выпускает', async () => {
    const { admin, raceId } = await raceWorld(h);
    const a = await rider(h, 'a@example.com');
    await enter(h, a.auth, raceId);
    await enableRaceTickets(h, admin.token, raceId);
    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'cancelled' } });
    expect(await reconcileAll(h)).toEqual({ races: 0, issued: 0, failed: 0 });
    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'published' } });
    // старт раньше `now − 61 сут` (окно гонки ≤ 60 сут) — регламент гонку не читает (ревью pass 1, LOW-3)
    await ticketsDb(h).ticketing.updateOne(
      {},
      { $set: { startsAt: new Date(h.clock.now().getTime() - 62 * 24 * 3_600_000) } },
    );
    expect(await reconcileAll(h)).toEqual({ races: 0, issued: 0, failed: 0 });
    await ticketsDb(h).ticketing.updateOne({}, { $set: { startsAt: new Date(RACE_START) } });
    // очный старт 24.10 10:00 Минска + 12 ч
    travelTo(h, new Date('2026-10-24T19:00:00Z'));
    // окно гонки открыто — гонка сверяется (отмены), но билеты уже не выпускаются (pass 3)
    expect(await reconcileAll(h)).toEqual({ races: 1, issued: 0, failed: 0 });
    // окно гонки + сутки закрыты — гонка не сверяется
    travelTo(h, new Date('2026-10-27T21:00:00Z'));
    expect(await reconcileAll(h)).toEqual({ races: 0, issued: 0, failed: 0 });
    expect(await ticketsDb(h).tickets.countDocuments()).toBe(0);
  });
});

describe('отмена заявки и смена группы (AC3, RC-T5)', () => {
  it('снятая заявка → сверка отменяет билет; ленивое чтение — тоже', async () => {
    const { admin, raceId } = await raceWorld(h);
    await enableRaceTickets(h, admin.token, raceId);
    const a = await rider(h, 'a@example.com');
    const b = await rider(h, 'b@example.com');
    for (const who of [a, b]) {
      await enter(h, who.auth, raceId);
      expect((await raceTicket(h, who.auth, raceId)).status).toBe(200);
    }
    expect((await withdraw(h, a.auth, raceId)).status).toBe(200);
    expect((await withdraw(h, b.auth, raceId)).status).toBe(200);

    await reconcileAll(h);
    expect((await ticketsDb(h).tickets.findOne({ userId: a.userId }))?.status).toBe('cancelled');
    // b — через ленивое чтение (тот же результат, что сверка)
    await ticketsDb(h).tickets.updateOne({ userId: b.userId }, { $set: { status: 'active' } });
    expect(MyTicketRef.parse((await raceTicket(h, b.auth, raceId)).body).status).toBe('cancelled');
  });

  it('check-in закрыт, окно гонки открыто, заявка снята — сверка отменяет билет; список и участники — cancelled (pass 3)', async () => {
    const { admin, raceId } = await raceWorld(h);
    await enableRaceTickets(h, admin.token, raceId);
    const a = await rider(h, 'a@example.com');
    await enter(h, a.auth, raceId);
    const { code } = MyTicketRef.parse((await raceTicket(h, a.auth, raceId)).body);
    // очный старт 24.10 10:00 + 12 ч прошёл, окно гонки — до 26.10 23:59
    travelTo(h, new Date('2026-10-25T09:00:00Z'));
    const auth = await signIn(h, a.email);
    expect((await withdraw(h, auth, raceId)).status).toBe(200);
    await reconcileAll(h);
    const list = MyTickets.parse((await call(h, 'GET', '/v1/tickets', undefined, auth)).body);
    expect(list.past).toEqual([expect.objectContaining({ code, status: 'cancelled' })]);
    const token = await panelSession(h, 'admin@example.by');
    const page = await panelCall(h, token, 'GET', ticketingUrl('race', raceId, 'tickets'));
    expect(page.body).toMatchObject({ items: [{ code, status: 'cancelled' }] });
  });

  it('START → Verified: категория обновлена, код тот же, второго события письма нет', async () => {
    const { admin, raceId } = await raceWorld(h);
    await enableRaceTickets(h, admin.token, raceId);
    const a = await rider(h, 'a@example.com');
    await enter(h, a.auth, raceId);
    const before = MyTicketRef.parse((await raceTicket(h, a.auth, raceId)).body);
    // повышение START → Verified меняет уровень и группу заявки (race-results-07) — прямой записью
    await resultsDb(h).entries.updateOne(
      { userId: a.userId },
      { $set: { tier: 'verified', groupKey: 'm_u40' } },
    );
    await reconcileAll(h);
    const doc = await ticketsDb(h).tickets.findOne({ userId: a.userId });
    expect(doc?.code).toBe(before.code);
    expect(doc?.category).toEqual({ kind: 'race', tier: 'verified', groupKey: 'm_u40' });
    expect(await issuedEvents(h)).toHaveLength(1);
  });
});
