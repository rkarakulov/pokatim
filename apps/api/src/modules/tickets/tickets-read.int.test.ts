import { MyTicketRef, MyTickets, TicketView } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { racesDb } from '../../../test/races';
import { signIn, travelTo } from '../../../test/results';
import {
  calendarStart,
  enableCalendarTickets,
  enableRaceTickets,
  enter,
  raceTicket,
  raceWorld,
  registerFor,
  rider,
  ticketingUrl,
  ticketView,
} from '../../../test/tickets';

/** Чтение своих билетов (AC4, AC5): только владелец, одинаковый 404, QR — только у активного предстоящего. */
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

async function raceTicketOf(email: string) {
  const { admin, raceId } = await raceWorld(h);
  await enableRaceTickets(h, admin.token, raceId);
  const who = await rider(h, email);
  await enter(h, who.auth, raceId);
  const ref = MyTicketRef.parse((await raceTicket(h, who.auth, raceId)).body);
  return { admin, raceId, who, code: ref.code };
}

describe('свой билет (AC5)', () => {
  it('владелец: событие, участник, категория, код, QR PKT1, инструкции; no-store', async () => {
    const { who, code } = await raceTicketOf('a@example.com');
    await call(h, 'PATCH', '/v1/profile', { publicName: 'Анна К.' }, who.auth);
    const res = await ticketView(h, who.auth, `${code.slice(0, 5).toLowerCase()}-${code.slice(5)}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const view = TicketView.parse(res.body);
    expect(view).toMatchObject({
      code,
      status: 'active',
      past: false,
      participantName: 'Анна К.',
      instructions: 'Приходите за час.',
      checkedInAt: null,
    });
    expect(view.qr).toMatch(/^PKT1\.[A-Za-z0-9_-]{43}$/);
    expect(view.category).toMatchObject({ kind: 'race' });
    // ответ — явный список полей
    expect(Object.keys(res.body as object).sort()).toEqual(
      [
        'code',
        'status',
        'past',
        'event',
        'participantName',
        'category',
        'qr',
        'instructions',
        'checkedInAt',
      ].sort(),
    );
  });

  it('чужой и несуществующий код — одинаковые 404 (тело и заголовки); гость — 401', async () => {
    const { code } = await raceTicketOf('a@example.com');
    const b = await rider(h, 'b@example.com');
    const foreign = await ticketView(h, b.auth, code);
    const missing = await ticketView(h, b.auth, 'ABCDE-FGHJK');
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    const headersOf = (res: typeof foreign) =>
      Object.fromEntries(Object.entries(res.headers).filter(([name]) => name !== 'date'));
    expect(headersOf(foreign)).toEqual(headersOf(missing));
    expect((await ticketView(h, {}, code)).status).toBe(401);
    expect((await call(h, 'GET', '/v1/tickets')).status).toBe(401);
  });
});

describe('отмена события (AC4)', () => {
  it('гонка отменена или билеты выключены — event_cancelled, QR null (обратимо)', async () => {
    const { admin, raceId, who, code } = await raceTicketOf('a@example.com');
    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'cancelled' } });
    let view = TicketView.parse((await ticketView(h, who.auth, code)).body);
    expect(view).toMatchObject({ status: 'event_cancelled', qr: null });

    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'published' } });
    const settings = await panelCall(h, admin.token, 'GET', ticketingUrl('race', raceId));
    const off = await panelCall(h, admin.token, 'PUT', ticketingUrl('race', raceId), {
      enabled: false,
      version: (settings.body as { version: number }).version,
    });
    expect(off.body).toMatchObject({ enabled: false, activeTickets: 1 });
    view = TicketView.parse((await ticketView(h, who.auth, code)).body);
    expect(view).toMatchObject({ status: 'event_cancelled', qr: null });

    await enableRaceTickets(h, admin.token, raceId);
    view = TicketView.parse((await ticketView(h, who.auth, code)).body);
    expect(view.status).toBe('active');
  });

  it('старт календаря снят с публикации — event_cancelled', async () => {
    const admin = (await raceTicketOf('x@example.com')).admin;
    const id = await calendarStart(h, admin.token);
    await enableCalendarTickets(h, admin.token, id);
    const a = await rider(h, 'a@example.com');
    const code = (await registerFor(h, a.auth, id)).body as { ticket: { code: string } };
    const start = await panelCall(h, admin.token, 'GET', `/v1/admin/calendar/${id}`);
    await panelCall(h, admin.token, 'POST', `/v1/admin/calendar/${id}/unpublish`, {
      reason: 'Отмена',
      version: (start.body as { version: number }).version,
    });
    const view = TicketView.parse((await ticketView(h, a.auth, code.ticket.code)).body);
    expect(view).toMatchObject({ status: 'event_cancelled', qr: null });
  });
});

describe('«Мои билеты» (RC-T8)', () => {
  it('предстоящие по дате ↑ без отменённых райдером; прошедшие — QR скрыт', async () => {
    const { admin, who, code: raceCode } = await raceTicketOf('a@example.com');
    const id = await calendarStart(h, admin.token);
    await enableCalendarTickets(h, admin.token, id);
    const calendarCode = ((await registerFor(h, who.auth, id)).body as { ticket: { code: string } })
      .ticket.code;
    const list = MyTickets.parse((await call(h, 'GET', '/v1/tickets', undefined, who.auth)).body);
    expect(list.upcoming.map((ref) => ref.code)).toEqual([raceCode, calendarCode]);
    expect(list.past).toEqual([]);

    // очный старт гонки 24.10 10:00 + 12 ч — прошла
    travelTo(h, new Date('2026-10-25T00:00:00Z'));
    const auth = await signIn(h, who.email);
    const later = MyTickets.parse((await call(h, 'GET', '/v1/tickets', undefined, auth)).body);
    expect(later.upcoming.map((ref) => ref.code)).toEqual([calendarCode]);
    expect(later.past.map((ref) => ref.code)).toEqual([raceCode]);
    const past = TicketView.parse((await ticketView(h, auth, raceCode)).body);
    expect(past).toMatchObject({ past: true, qr: null, status: 'active' });

    await call(h, 'POST', `/v1/calendar/${id}/registration/cancel`, {}, auth);
    const after = MyTickets.parse((await call(h, 'GET', '/v1/tickets', undefined, auth)).body);
    expect(after.upcoming).toEqual([]);
  });
});
