import { CheckInView, EventTicketsPage, MyTicketRef, TicketView } from '@pokatim/contracts';
import { RateLimiter } from '@rkarakulov/api-kit/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { memberUser, panel, panelCall, panelSession } from '../../../test/panel';
import { racesDb } from '../../../test/races';
import { signIn, travelTo, withdraw } from '../../../test/results';
import {
  calendarStart,
  enableCalendarTickets,
  enableRaceTickets,
  enter,
  raceTicket,
  raceWorld,
  reconcileAll,
  registerFor,
  rider,
  ticketingUrl,
  ticketView,
} from '../../../test/tickets';

/**
 * Check-in в панели (AC3, AC4, AC6): право `tickets.checkin`, доступ к событию (чужое — 404), условный переход
 * `active → checked_in` (параллельные сканы — одна отметка), журнал без имени и e-mail.
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

const LOOKUP = '/v1/admin/tickets/lookup';
const CHECK_IN = '/v1/admin/tickets/check-in';
/** Окно check-in гонки стенда открыто: 24.10 09:00 Минска (старт — 10:00). */
const OPEN = new Date('2026-10-24T06:00:00Z');

/** Гонка организатора с билетами, заявка райдера; к моменту `OPEN` — QR и код. */
async function world() {
  const { admin, raceId } = await raceWorld(h);
  const organizerId = await memberUser(h, 'org@example.by', 'organizer');
  await memberUser(h, 'org2@example.by', 'organizer');
  await memberUser(h, 'mod@example.by', 'moderator');
  await racesDb(h).races.updateOne({ _id: raceId }, { $set: { ownerUserId: organizerId } });
  await enableRaceTickets(h, admin.token, raceId);
  const who = await rider(h, 'a@example.com');
  await enter(h, who.auth, raceId);
  const { code } = MyTicketRef.parse((await raceTicket(h, who.auth, raceId)).body);
  travelTo(h, OPEN);
  const auth = await signIn(h, who.email);
  const view = TicketView.parse((await ticketView(h, auth, code)).body);
  return {
    raceId,
    organizerId,
    who: { ...who, auth },
    code,
    qr: view.qr!,
    tokens: {
      admin: await panelSession(h, 'admin@example.by'),
      organizer: await panelSession(h, 'org@example.by'),
      other: await panelSession(h, 'org2@example.by'),
      moderator: await panelSession(h, 'mod@example.by'),
    },
  };
}

const checkInAudit = () => panel(h).audit.find({ action: 'tickets.checked_in' }).toArray();

describe('права и доступ (AC6, RC-T9)', () => {
  it('модератор — 403; организатор чужой гонки — 404 (как нет билета); свой — ready', async () => {
    const w = await world();
    expect((await panelCall(h, w.tokens.moderator, 'POST', LOOKUP, { qr: w.qr })).status).toBe(403);
    const foreign = await panelCall(h, w.tokens.other, 'POST', CHECK_IN, { qr: w.qr });
    const missing = await panelCall(h, w.tokens.other, 'POST', CHECK_IN, {
      code: 'ABCDE-FGHJK',
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    const own = await panelCall(h, w.tokens.organizer, 'POST', LOOKUP, { qr: w.qr });
    expect(own.status).toBe(200);
    expect(own.headers['cache-control']).toBe('no-store');
    expect(CheckInView.parse(own.body)).toMatchObject({
      outcome: 'ready',
      ticket: { code: w.code, status: 'active', checkedInAt: null, checkedInBy: null },
    });
    expect(await checkInAudit()).toHaveLength(0);
  });

  it('старт календаря: организатор — 404, admin — отмечает', async () => {
    const w = await world();
    const id = await calendarStart(h, w.tokens.admin, {
      startsOn: '2026-10-24',
      startTime: '12:00',
    });
    await enableCalendarTickets(h, w.tokens.admin, id);
    const registered = await registerFor(h, w.who.auth, id);
    const code = (registered.body as { ticket: { code: string } }).ticket.code;
    expect((await panelCall(h, w.tokens.organizer, 'POST', CHECK_IN, { code })).status).toBe(404);
    const res = await panelCall(h, w.tokens.admin, 'POST', CHECK_IN, { code });
    expect(CheckInView.parse(res.body).outcome).toBe('checked_in');
  });
});

describe('отметка (AC6)', () => {
  it('валидный QR → checked_in, время и кто; одна запись журнала без имени; повтор — already_checked_in', async () => {
    const w = await world();
    await panel(h).members.updateOne({ _id: w.organizerId }, { $set: { displayName: 'Ольга' } });
    const res = await panelCall(h, w.tokens.organizer, 'POST', CHECK_IN, { qr: w.qr });
    expect(res.status).toBe(200);
    const view = CheckInView.parse(res.body);
    expect(view).toMatchObject({
      outcome: 'checked_in',
      ticket: { status: 'checked_in', checkedInAt: OPEN.toISOString(), checkedInBy: 'Ольга' },
    });
    const audit = await checkInAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: w.organizerId },
      subject: { kind: 'race', id: w.raceId, label: 'Минское кольцо' },
      details: { ticketCode: w.code },
    });
    expect(JSON.stringify(audit[0])).not.toMatch(/example\.com|Участник/);

    const again = CheckInView.parse(
      (await panelCall(h, w.tokens.admin, 'POST', CHECK_IN, { code: w.code })).body,
    );
    expect(again).toMatchObject({
      outcome: 'already_checked_in',
      ticket: { checkedInBy: 'Ольга' },
    });
    expect(await checkInAudit()).toHaveLength(1);
    // владелец видит отметку, QR больше не показывается
    expect(TicketView.parse((await ticketView(h, w.who.auth, w.code)).body)).toMatchObject({
      status: 'checked_in',
      qr: null,
    });
  });

  it('5 параллельных сканов — одна отметка и одна запись журнала', async () => {
    const w = await world();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        panelCall(h, w.tokens.organizer, 'POST', CHECK_IN, { qr: w.qr }),
      ),
    );
    const outcomes = results.map((res) => CheckInView.parse(res.body).outcome).sort();
    expect(outcomes).toEqual([
      'already_checked_in',
      'already_checked_in',
      'already_checked_in',
      'already_checked_in',
      'checked_in',
    ]);
    expect(await checkInAudit()).toHaveLength(1);
  });

  it('код с дефисом и строчными — находит; мусор в QR — 400', async () => {
    const w = await world();
    const code = `${w.code.slice(0, 5).toLowerCase()}-${w.code.slice(5)}`;
    const res = await panelCall(h, w.tokens.organizer, 'POST', LOOKUP, { code });
    expect(CheckInView.parse(res.body).ticket.code).toBe(w.code);
    expect(
      (await panelCall(h, w.tokens.organizer, 'POST', LOOKUP, { qr: 'PKT1.short' })).status,
    ).toBe(400);
    expect(
      (await panelCall(h, w.tokens.organizer, 'POST', LOOKUP, { qr: w.qr, code: w.code })).status,
    ).toBe(400);
  });

  it('вне окна — outside_window без отметки', async () => {
    const w = await world();
    // старт 24.10 10:00 Минска + 12 ч
    travelTo(h, new Date('2026-10-24T19:00:00Z'));
    const token = await panelSession(h, 'org@example.by');
    const res = CheckInView.parse(
      (await panelCall(h, token, 'POST', CHECK_IN, { code: w.code })).body,
    );
    expect(res).toMatchObject({ outcome: 'outside_window', ticket: { status: 'active' } });
    expect(await checkInAudit()).toHaveLength(0);
  });

  it('лимит tickets-checkin на сессию — 429', async () => {
    const w = await world();
    const limiter = h.app.get(RateLimiter, { strict: false });
    const consume = vi.spyOn(limiter, 'consume');
    consume.mockResolvedValueOnce({ allowed: false, retryAfterSec: 30 } as never);
    const res = await panelCall(h, w.tokens.organizer, 'POST', LOOKUP, { qr: w.qr });
    expect(res.status).toBe(429);
    expect(String(consume.mock.calls.at(-1)?.[0])).toMatch(/^tickets-checkin:/);
  });
});

describe('отказы (AC3, AC4)', () => {
  it('снятая заявка — cancelled (до сверки тоже); отменённая гонка — event_cancelled', async () => {
    const w = await world();
    expect((await withdraw(h, w.who.auth, w.raceId)).status).toBe(200);
    const cancelled = CheckInView.parse(
      (await panelCall(h, w.tokens.organizer, 'POST', CHECK_IN, { qr: w.qr })).body,
    );
    expect(cancelled.outcome).toBe('cancelled');
    await reconcileAll(h);
    expect(await checkInAudit()).toHaveLength(0);
  });

  it('гонка отменена — event_cancelled; выключены билеты — event_cancelled', async () => {
    const w = await world();
    await racesDb(h).races.updateOne({ _id: w.raceId }, { $set: { status: 'cancelled' } });
    const res = CheckInView.parse(
      (await panelCall(h, w.tokens.organizer, 'POST', CHECK_IN, { qr: w.qr })).body,
    );
    expect(res).toMatchObject({
      outcome: 'event_cancelled',
      ticket: { status: 'event_cancelled' },
    });
    await racesDb(h).races.updateOne({ _id: w.raceId }, { $set: { status: 'published' } });
    const settings = await panelCall(h, w.tokens.admin, 'GET', ticketingUrl('race', w.raceId));
    await panelCall(h, w.tokens.admin, 'PUT', ticketingUrl('race', w.raceId), {
      enabled: false,
      version: (settings.body as { version: number }).version,
    });
    const off = CheckInView.parse(
      (await panelCall(h, w.tokens.organizer, 'POST', CHECK_IN, { qr: w.qr })).body,
    );
    expect(off.outcome).toBe('event_cancelled');
  });
});

describe('список участников', () => {
  it('tickets.checkin: организатор своей гонки; имя без согласия, иначе «Участник · маска»; письмо — pending', async () => {
    const w = await world();
    const url = ticketingUrl('race', w.raceId, 'tickets');
    expect((await panelCall(h, w.tokens.moderator, 'GET', url)).status).toBe(403);
    expect((await panelCall(h, w.tokens.other, 'GET', url)).status).toBe(404);
    const page = EventTicketsPage.parse((await panelCall(h, w.tokens.organizer, 'GET', url)).body);
    expect(page).toEqual({
      items: [
        {
          code: w.code,
          status: 'active',
          participantName: 'Участник · a***@example.com',
          category: expect.objectContaining({ kind: 'race' }),
          checkedInAt: null,
          emailState: 'pending',
        },
      ],
      nextCursor: null,
    });
  });
});
