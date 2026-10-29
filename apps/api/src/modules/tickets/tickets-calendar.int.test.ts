import { CalendarRegistrationState, EventTicketingPublic } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { panelCall } from '../../../test/panel';
import { staff } from '../../../test/races';
import { signIn, travelTo } from '../../../test/results';
import {
  CALENDAR_START,
  calendarStart,
  enableCalendarTickets,
  issuedEvents,
  registerFor,
  registrationUrl,
  rider,
  ticketingUrl,
  ticketsDb,
} from '../../../test/tickets';

/**
 * Регистрация на старт календаря (AC3, AC8): места — условный `$inc` первой операцией транзакции, одна активная на
 * пользователя, закрыта с момента старта, повтор после отмены — новый билет.
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

async function world(settings: Record<string, unknown> = {}, start: Record<string, unknown> = {}) {
  const admin = await staff(h, 'admin@example.by', 'admin');
  const id = await calendarStart(h, admin.token, start);
  await enableCalendarTickets(h, admin.token, id, settings);
  return { admin, id };
}

const state = (body: unknown) => CalendarRegistrationState.parse(body);

describe('регистрация и билет (AC8)', () => {
  it('201 с регистрацией и билетом; повтор — 200 с той же; одно событие письма; no-store', async () => {
    const { id } = await world();
    const a = await rider(h, 'a@example.com');
    const first = await registerFor(h, a.auth, id);
    expect(first.status).toBe(201);
    expect(first.headers['cache-control']).toBe('no-store');
    const created = state(first.body);
    expect(created.registration).toMatchObject({ status: 'active', distanceKm: 42.2 });
    expect(created.ticket).toMatchObject({ status: 'active', past: false });
    expect(created.ticket?.event).toMatchObject({
      kind: 'calendar',
      id,
      startsAt: CALENDAR_START.toISOString(),
      place: 'Площадь Независимости',
      city: 'Минск',
    });

    const again = await registerFor(h, a.auth, id);
    expect(again.status).toBe(200);
    expect(state(again.body).registration?.id).toBe(created.registration?.id);
    expect(state((await call(h, 'GET', registrationUrl(id), undefined, a.auth)).body)).toEqual(
      created,
    );
    expect(await issuedEvents(h)).toHaveLength(1);
    expect(await ticketsDb(h).tickets.findOne({})).toMatchObject({
      category: { kind: 'calendar', distanceKm: 42.2 },
    });
  });

  it('дистанция: обязательна при > 1, из списка; одна — подставляется', async () => {
    const { id } = await world();
    const a = await rider(h, 'a@example.com');
    const missing = await registerFor(h, a.auth, id, {});
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({
      details: { fields: [{ path: 'distanceKm', code: 'REQUIRED' }] },
    });
    expect((await registerFor(h, a.auth, id, { distanceKm: 21 })).status).toBe(400);
    expect((await registerFor(h, a.auth, id, { distanceKm: 42.2, userId: a.userId })).status).toBe(
      400,
    );

    const admin = await staff(h, 'admin2@example.by', 'admin');
    const single = await calendarStart(h, admin.token, { distancesKm: [10] });
    await enableCalendarTickets(h, admin.token, single);
    const res = await registerFor(h, a.auth, single, {});
    expect(res.status).toBe(201);
    expect(state(res.body).registration?.distanceKm).toBe(10);
  });

  it('capacity = 1, два параллельных POST — один 201, один EVENT_FULL; места в публичной сводке', async () => {
    const { id } = await world({ capacity: 1 });
    const a = await rider(h, 'a@example.com');
    const b = await rider(h, 'b@example.com');
    const results = await Promise.all([registerFor(h, a.auth, id), registerFor(h, b.auth, id)]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.find((res) => res.status === 409)?.body).toMatchObject({ code: 'EVENT_FULL' });
    expect(await ticketsDb(h).registrations.countDocuments({ status: 'active' })).toBe(1);
    expect(await ticketsDb(h).tickets.countDocuments()).toBe(1);
    expect((await ticketsDb(h).ticketing.findOne({}))?.registeredCount).toBe(1);

    const summary = await call(h, 'GET', `/v1/events/calendar/${id}/ticketing`);
    expect(summary.headers['cache-control']).toBe('public, max-age=60');
    expect(EventTicketingPublic.parse(summary.body)).toMatchObject({
      enabled: true,
      capacity: 1,
      seatsLeft: 0,
      registrationOpen: false,
      distancesKm: [10, 42.2],
    });
  });

  it('один райдер, два параллельных POST на последнее место — 201 и 200 с той же регистрацией (ревью pass 1)', async () => {
    const { id } = await world({ capacity: 1 });
    const a = await rider(h, 'a@example.com');
    const results = await Promise.all([registerFor(h, a.auth, id), registerFor(h, a.auth, id)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 201]);
    const [first, second] = results.map((res) => state(res.body).registration?.id);
    expect(first).toBe(second);
    expect(await ticketsDb(h).registrations.countDocuments()).toBe(1);
  });

  it('с момента старта — EVENT_REGISTRATION_CLOSED{started}; выключено — not_enabled; снят — unpublished', async () => {
    const { admin, id } = await world();
    const a = await rider(h, 'a@example.com');

    const version = (
      (await panelCall(h, admin.token, 'GET', ticketingUrl('calendar', id))).body as {
        version: number;
      }
    ).version;
    await panelCall(h, admin.token, 'PUT', ticketingUrl('calendar', id), {
      enabled: false,
      version,
    });
    expect((await registerFor(h, a.auth, id)).body).toMatchObject({
      code: 'EVENT_REGISTRATION_CLOSED',
      details: { reason: 'not_enabled' },
    });
    await enableCalendarTickets(h, admin.token, id);

    const start = await panelCall(h, admin.token, 'GET', `/v1/admin/calendar/${id}`);
    await panelCall(h, admin.token, 'POST', `/v1/admin/calendar/${id}/unpublish`, {
      reason: 'Перенос',
      version: (start.body as { version: number }).version,
    });
    expect((await registerFor(h, a.auth, id)).body).toMatchObject({
      details: { reason: 'unpublished' },
    });
    const unpublished = await panelCall(h, admin.token, 'GET', `/v1/admin/calendar/${id}`);
    await panelCall(h, admin.token, 'POST', `/v1/admin/calendar/${id}/republish`, {
      version: (unpublished.body as { version: number }).version,
    });

    travelTo(h, CALENDAR_START);
    const late = await registerFor(h, await signIn(h, a.email), id);
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ details: { reason: 'started' } });
  });
});

describe('отмена регистрации (AC3, AC8)', () => {
  it('отмена → регистрация и билет cancelled, место освобождено; повтор после отмены — новый билет и код', async () => {
    const { id } = await world({ capacity: 1 });
    const a = await rider(h, 'a@example.com');
    const first = state((await registerFor(h, a.auth, id)).body);
    const cancelled = await call(h, 'POST', `${registrationUrl(id)}/cancel`, {}, a.auth);
    expect(cancelled.status).toBe(200);
    expect(state(cancelled.body)).toEqual({ registration: null, ticket: null });
    expect((await ticketsDb(h).tickets.findOne({ code: first.ticket?.code }))?.status).toBe(
      'cancelled',
    );
    expect((await ticketsDb(h).ticketing.findOne({}))?.registeredCount).toBe(0);
    // повтор отмены — то же состояние
    expect((await call(h, 'POST', `${registrationUrl(id)}/cancel`, {}, a.auth)).status).toBe(200);

    const again = await registerFor(h, a.auth, id);
    expect(again.status).toBe(201);
    const second = state(again.body);
    expect(second.registration?.id).not.toBe(first.registration?.id);
    expect(second.ticket?.code).not.toBe(first.ticket?.code);
    expect(await issuedEvents(h)).toHaveLength(2);
  });

  it('отмена с момента старта — EVENT_REGISTRATION_CLOSED{started}; гость — 401; нет старта — 404', async () => {
    const { id } = await world();
    const a = await rider(h, 'a@example.com');
    await registerFor(h, a.auth, id);
    travelTo(h, CALENDAR_START);
    const auth = await signIn(h, a.email);
    const late = await call(h, 'POST', `${registrationUrl(id)}/cancel`, {}, auth);
    expect(late.body).toMatchObject({ details: { reason: 'started' } });
    expect((await call(h, 'GET', registrationUrl(id))).status).toBe(401);
    expect(
      (
        await call(
          h,
          'GET',
          registrationUrl('01890a5d-ac96-774b-bcce-b302099a8057'),
          undefined,
          auth,
        )
      ).status,
    ).toBe(404);
  });
});
