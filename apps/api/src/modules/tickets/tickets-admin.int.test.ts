import { EventTicketingPublic, EventTicketingSettings } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import { call } from '../../../test/identity';
import { memberUser, panel, panelCall, panelSession } from '../../../test/panel';
import { racesDb } from '../../../test/races';
import {
  calendarStart,
  enableCalendarTickets,
  enter,
  raceWorld,
  registerFor,
  rider,
  ticketingUrl,
} from '../../../test/tickets';

/** Настройки билетов в панели: права по `kind` (RC-T9), версия, правила RC-T2/T3/T6, журнал (RC-T10). */
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

const RACE_BODY = {
  enabled: true,
  startsAt: '2026-10-24T07:00:00Z',
  place: 'Парк Победы',
  version: 0,
};

async function world() {
  const { admin, raceId } = await raceWorld(h);
  const organizerId = await memberUser(h, 'org@example.by', 'organizer');
  await memberUser(h, 'org2@example.by', 'organizer');
  await memberUser(h, 'mod@example.by', 'moderator');
  await racesDb(h).races.updateOne({ _id: raceId }, { $set: { ownerUserId: organizerId } });
  const calendarId = await calendarStart(h, admin.token);
  return {
    raceId,
    calendarId,
    organizerId,
    tokens: {
      admin: admin.token,
      organizer: await panelSession(h, 'org@example.by'),
      other: await panelSession(h, 'org2@example.by'),
      moderator: await panelSession(h, 'mod@example.by'),
    },
  };
}

const settingsAudit = () => panel(h).audit.find({ action: 'tickets.settings_updated' }).toArray();

describe('права (RC-T9)', () => {
  it('гонка: модератор — 403, чужой организатор — 404, владелец — 200; календарь: организатор — 403', async () => {
    const w = await world();
    const race = ticketingUrl('race', w.raceId);
    const calendar = ticketingUrl('calendar', w.calendarId);
    expect((await panelCall(h, w.tokens.moderator, 'GET', race)).status).toBe(403);
    expect((await panelCall(h, w.tokens.moderator, 'PUT', race, RACE_BODY)).status).toBe(403);
    expect((await panelCall(h, w.tokens.other, 'GET', race)).status).toBe(404);
    expect((await panelCall(h, w.tokens.other, 'PUT', race, RACE_BODY)).status).toBe(404);
    expect((await panelCall(h, w.tokens.organizer, 'GET', calendar)).status).toBe(403);
    expect(
      (await panelCall(h, w.tokens.organizer, 'PUT', calendar, { enabled: true, version: 0 }))
        .status,
    ).toBe(403);
    const own = await panelCall(h, w.tokens.organizer, 'GET', race);
    expect(own.status).toBe(200);
    expect(EventTicketingSettings.parse(own.body)).toMatchObject({
      enabled: false,
      version: 0,
      startsAt: null,
      activeTickets: 0,
    });
    expect((await panelCall(h, w.tokens.admin, 'GET', calendar)).status).toBe(200);
    expect((await panelCall(h, undefined, 'GET', race)).status).toBe(401);
    expect(
      (await panelCall(h, w.tokens.admin, 'GET', ticketingUrl('race', w.calendarId))).status,
    ).toBe(404);
    expect(
      (await panelCall(h, w.tokens.admin, 'GET', '/v1/admin/events/ride/x/ticketing')).status,
    ).toBe(400);
  });
});

describe('гонка (RC-T3, RC-T10)', () => {
  it('включение: запись, журнал с changedFields; повтор тех же значений — без записи; устаревшая версия — 409', async () => {
    const w = await world();
    const url = ticketingUrl('race', w.raceId);
    const res = await panelCall(h, w.tokens.organizer, 'PUT', url, RACE_BODY);
    expect(res.status).toBe(200);
    expect(EventTicketingSettings.parse(res.body)).toMatchObject({
      enabled: true,
      startsAt: '2026-10-24T07:00:00.000Z',
      place: 'Парк Победы',
      version: 1,
    });
    const audit = await settingsAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: { kind: 'user', userId: w.organizerId },
      subject: { kind: 'race', id: w.raceId, label: 'Минское кольцо' },
      details: { changedFields: ['enabled', 'startsAt', 'place'] },
    });

    const same = await panelCall(h, w.tokens.organizer, 'PUT', url, { ...RACE_BODY, version: 1 });
    expect(EventTicketingSettings.parse(same.body).version).toBe(1);
    expect(await settingsAudit()).toHaveLength(1);
    const stale = await panelCall(h, w.tokens.organizer, 'PUT', url, { ...RACE_BODY, version: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'CONFLICT' });
  });

  it('обязательные поля, старт вне окна, конец раньше старта, вместимость у гонки — 400 по полям', async () => {
    const w = await world();
    const url = ticketingUrl('race', w.raceId);
    const fields = async (body: object) =>
      (
        (await panelCall(h, w.tokens.admin, 'PUT', url, body)).body as {
          details?: { fields?: { path: string; code: string }[] };
        }
      ).details?.fields;
    expect(await fields({ enabled: true, version: 0 })).toEqual([
      { path: 'startsAt', code: 'REQUIRED' },
      { path: 'place', code: 'REQUIRED' },
    ]);
    expect(await fields({ ...RACE_BODY, startsAt: '2026-10-28T07:00:00Z' })).toEqual([
      { path: 'startsAt', code: 'INVALID' },
    ]);
    expect(await fields({ ...RACE_BODY, endsAt: '2026-10-24T06:00:00Z' })).toEqual([
      { path: 'endsAt', code: 'DATE_ORDER' },
    ]);
    expect(await fields({ ...RACE_BODY, capacity: 10 })).toEqual([
      { path: 'capacity', code: 'INVALID' },
    ]);
    expect(await settingsAudit()).toHaveLength(0);
  });

  it('отменённая гонка — 409 TICKETING_INVALID_STATE{event_cancelled}', async () => {
    const w = await world();
    await racesDb(h).races.updateOne({ _id: w.raceId }, { $set: { status: 'cancelled' } });
    const res = await panelCall(
      h,
      w.tokens.admin,
      'PUT',
      ticketingUrl('race', w.raceId),
      RACE_BODY,
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'TICKETING_INVALID_STATE',
      details: { reason: 'event_cancelled' },
    });
  });

  it('выключение после выпуска — activeTickets в ответе (RC-T6)', async () => {
    const w = await world();
    const url = ticketingUrl('race', w.raceId);
    await panelCall(h, w.tokens.admin, 'PUT', url, RACE_BODY);
    const a = await rider(h, 'a@example.com');
    await enter(h, a.auth, w.raceId);
    await call(h, 'GET', `/v1/races/${w.raceId}/ticket`, undefined, a.auth);
    const off = await panelCall(h, w.tokens.admin, 'PUT', url, { enabled: false, version: 1 });
    expect(EventTicketingSettings.parse(off.body)).toMatchObject({
      enabled: false,
      activeTickets: 1,
      startsAt: '2026-10-24T07:00:00.000Z',
    });
  });
});

describe('календарь (RC-T2, RC-T6)', () => {
  it('дата, время и место — из старта; их в теле нет — 400', async () => {
    const w = await world();
    const url = ticketingUrl('calendar', w.calendarId);
    const res = await panelCall(h, w.tokens.admin, 'PUT', url, {
      enabled: true,
      capacity: 100,
      address: 'пр. Независимости, 1',
      version: 0,
    });
    expect(EventTicketingSettings.parse(res.body)).toMatchObject({
      enabled: true,
      startsAt: '2026-11-01T07:00:00.000Z',
      place: 'Площадь Независимости',
      address: 'пр. Независимости, 1',
      capacity: 100,
    });
    const bad = await panelCall(h, w.tokens.admin, 'PUT', url, {
      enabled: true,
      startsAt: '2026-11-01T07:00:00Z',
      place: 'x',
      version: 1,
    });
    expect(bad.status).toBe(400);
    expect((await settingsAudit())[0]).toMatchObject({
      subject: { kind: 'calendar_start', id: w.calendarId },
    });
  });

  it('старт без времени — 409 start_time_required; вместимость меньше зарегистрированных — capacity_below_registered', async () => {
    const w = await world();
    const noTime = await calendarStart(h, w.tokens.admin, { startTime: null });
    const res = await panelCall(h, w.tokens.admin, 'PUT', ticketingUrl('calendar', noTime), {
      enabled: true,
      version: 0,
    });
    expect(res.body).toMatchObject({
      code: 'TICKETING_INVALID_STATE',
      details: { reason: 'start_time_required' },
    });

    const version = await enableCalendarTickets(h, w.tokens.admin, w.calendarId, { capacity: 5 });
    for (const email of ['a@example.com', 'b@example.com']) {
      const who = await rider(h, email);
      expect((await registerFor(h, who.auth, w.calendarId)).status).toBe(201);
    }
    const shrink = await panelCall(
      h,
      w.tokens.admin,
      'PUT',
      ticketingUrl('calendar', w.calendarId),
      {
        enabled: true,
        capacity: 1,
        version,
      },
    );
    expect(shrink.body).toMatchObject({ details: { reason: 'capacity_below_registered' } });
    const ok = await panelCall(h, w.tokens.admin, 'PUT', ticketingUrl('calendar', w.calendarId), {
      enabled: true,
      capacity: 2,
      version,
    });
    expect(EventTicketingSettings.parse(ok.body)).toMatchObject({
      capacity: 2,
      registeredCount: 2,
      activeTickets: 2,
    });
  });
});

describe('публичная сводка (RC-T7)', () => {
  it('без настроек и для неизвестного события — { enabled: false }; гонка — без мест и регистрации', async () => {
    const w = await world();
    const url = (kind: string, id: string) => `/v1/events/${kind}/${id}/ticketing`;
    expect((await call(h, 'GET', url('race', w.raceId))).body).toEqual({ enabled: false });
    expect(
      (await call(h, 'GET', url('calendar', '01890a5d-ac96-774b-bcce-b302099a8057'))).body,
    ).toEqual({ enabled: false });
    await panelCall(h, w.tokens.admin, 'PUT', ticketingUrl('race', w.raceId), RACE_BODY);
    const race = EventTicketingPublic.parse((await call(h, 'GET', url('race', w.raceId))).body);
    expect(race).toEqual({
      enabled: true,
      startsAt: '2026-10-24T07:00:00.000Z',
      endsAt: null,
      place: 'Парк Победы',
      address: null,
      capacity: null,
      seatsLeft: null,
      registrationOpen: false,
      distancesKm: [],
    });
  });
});
