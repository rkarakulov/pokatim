import { EventTicketingSettings } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, HOUR, MINUTE, type Harness } from '../../../test/harness';
import { call, collections } from '../../../test/identity';
import {
  eventsOfType,
  notificationsDb,
  notificationsIntake,
  notificationsOf,
  runEmail,
  runIntake,
} from '../../../test/notifications';
import { panelCall, panelSession } from '../../../test/panel';
import { racesDb } from '../../../test/races';
import { signIn, travelTo, withdraw } from '../../../test/results';
import {
  calendarStart,
  enableCalendarTickets,
  enableRaceTickets,
  enter,
  raceTicket,
  raceWorld,
  registerFor,
  RACE_START,
  rider,
  ticketingUrl,
  ticketsDb,
} from '../../../test/tickets';
import { TicketReminders } from './ticket-reminders';
import { TICKETS_REMINDER_DUE } from './tickets.events';

/**
 * Напоминания участникам (PR D, AC10, RC-D2…D5): регламент `tickets.reminders` — одно событие outbox на (событие,
 * правило, отправку), метка `remindersSent` у каждого получившего билета; повтор и параллельные прогоны — одна
 * отправка; отменённые, отмеченные и выпущенные после времени отправки — без напоминания.
 */
const ORIGIN = 'https://pokatim.test';
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ PUSH_ENABLED: 'true', APP_WEB_ORIGIN: ORIGIN });
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

const START = new Date(RACE_START);
/** 24.10 07:00 UTC − 24 ч. */
const DUE_24 = new Date(START.getTime() - 24 * HOUR);

/** Сессия админа панели заново (часы стенда ушли вперёд). */
const adminToken = () => panelSession(h, 'admin@example.by');
const dispatchDue = () => h.worker.get(TicketReminders).dispatchDue();
const reminderEvents = () => eventsOfType(h, TICKETS_REMINDER_DUE);
const sentOf = async (userId: string) =>
  (await ticketsDb(h).tickets.findOne({ userId }))?.remindersSent ?? [];

/** Гонка с билетами и правилами; райдеры с билетами (выпуск лениво); id правил. */
async function raceWithReminders(
  emails: string[],
  reminders: { offsetHours: number; text: string }[] = [{ offsetHours: 24, text: 'Паспорт' }],
) {
  const { admin, raceId } = await raceWorld(h);
  await enableRaceTickets(h, admin.token, raceId, { reminders });
  const riders = [];
  for (const email of emails) {
    const who = await rider(h, email);
    await enter(h, who.auth, raceId);
    expect((await raceTicket(h, who.auth, raceId)).status).toBe(200);
    riders.push(who);
  }
  const settings = EventTicketingSettings.parse(
    (await panelCall(h, admin.token, 'GET', ticketingUrl('race', raceId))).body,
  );
  return { admin, raceId, riders, settings };
}

/** Правка правил панелью по текущей версии. */
async function putReminders(
  raceId: string,
  reminders: { id?: string; offsetHours: number; text: string }[],
) {
  const token = await adminToken();
  const current = EventTicketingSettings.parse(
    (await panelCall(h, token, 'GET', ticketingUrl('race', raceId))).body,
  );
  const res = await panelCall(h, token, 'PUT', ticketingUrl('race', raceId), {
    enabled: current.enabled,
    version: current.version,
    reminders,
  });
  expect(res.status).toBe(200);
  return EventTicketingSettings.parse(res.body);
}

describe('отправка один раз на билет и правило (AC10)', () => {
  it('до времени — ничего; в dueAt — одно событие, метки активным; отменённому и отмеченному — нет; повтор — без отправки', async () => {
    const { raceId, riders, settings } = await raceWithReminders([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ]);
    const [a, b, c, d] = riders;
    expect((await withdraw(h, c!.auth, raceId)).status).toBe(200);
    expect((await raceTicket(h, c!.auth, raceId)).status).toBe(200);
    await ticketsDb(h).tickets.updateOne(
      { userId: d!.userId },
      { $set: { status: 'checked_in', checkedInAt: h.clock.now() } },
    );

    travelTo(h, new Date(DUE_24.getTime() - MINUTE));
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(0);

    travelTo(h, DUE_24);
    await dispatchDue();
    const events = await reminderEvents();
    expect(events).toHaveLength(1);
    const reminderId = settings.reminders[0]!.id;
    const payload = events[0]!.payload as { dispatchId: string };
    expect(payload).toEqual({
      kind: 'race',
      eventId: raceId,
      reminderId,
      dispatchId: expect.any(String),
    });
    for (const who of [a, b]) {
      expect(await sentOf(who!.userId)).toEqual([
        { reminderId, dispatchId: payload.dispatchId, at: DUE_24 },
      ]);
    }
    expect(await sentOf(c!.userId)).toEqual([]);
    expect(await sentOf(d!.userId)).toEqual([]);

    await dispatchDue();
    travelTo(h, new Date(DUE_24.getTime() + 10 * MINUTE));
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(1);
    // панель видит отправку
    const view = EventTicketingSettings.parse(
      (await panelCall(h, await adminToken(), 'GET', ticketingUrl('race', raceId))).body,
    );
    expect(view.reminders[0]).toMatchObject({ sentAt: DUE_24.toISOString(), sentCount: 2 });
  });

  it('два параллельных прогона — одна отправка, одна метка на билет', async () => {
    const { riders } = await raceWithReminders(['a@example.com', 'b@example.com']);
    travelTo(h, DUE_24);
    await Promise.all([dispatchDue(), dispatchDue()]);
    expect(await reminderEvents()).toHaveLength(1);
    for (const who of riders) expect(await sentOf(who.userId)).toHaveLength(1);
  });
});

describe('кому и когда (RC-D3, RC-D5)', () => {
  it('догоняние после простоя — уходит; билет, выпущенный после времени отправки, — нет', async () => {
    const { raceId, riders } = await raceWithReminders(['a@example.com']);
    travelTo(h, new Date(DUE_24.getTime() + 10 * MINUTE));
    const late = await rider(h, 'late@example.com');
    await enter(h, late.auth, raceId);
    expect((await raceTicket(h, late.auth, raceId)).status).toBe(200);
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(1);
    expect(await sentOf(riders[0]!.userId)).toHaveLength(1);
    expect(await sentOf(late.userId)).toEqual([]);
  });

  it('гонка отменена, билеты выключены, событие началось — не уходит', async () => {
    const { raceId } = await raceWithReminders(['a@example.com']);
    travelTo(h, DUE_24);
    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'cancelled' } });
    await dispatchDue();
    await racesDb(h).races.updateOne({ _id: raceId }, { $set: { status: 'published' } });
    await ticketsDb(h).ticketing.updateOne({ eventId: raceId }, { $set: { enabled: false } });
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(0);
    await ticketsDb(h).ticketing.updateOne({ eventId: raceId }, { $set: { enabled: true } });
    travelTo(h, START);
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(0);
  });

  it('правило задано после своего времени отправки — не уходит (late)', async () => {
    // «сейчас» стенда — 22.10 09:00; за 48 ч до старта — 22.10 07:00, уже прошло
    await raceWithReminders(['a@example.com'], [{ offsetHours: 48, text: 'Поздно' }]);
    travelTo(h, new Date(START.getTime() - HOUR));
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(0);
  });
});

describe('правка правил после отправки (RC-D4)', () => {
  it('смена текста — без повтора; смена offset — только новым билетам; удалённое — не уходит', async () => {
    const { raceId, riders, settings } = await raceWithReminders(['a@example.com']);
    const [a] = riders;
    const reminderId = settings.reminders[0]!.id;
    travelTo(h, DUE_24);
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(1);

    await putReminders(raceId, [{ id: reminderId, offsetHours: 24, text: 'Новый' }]);
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(1);

    // новый участник, затем правило «за 12 ч» (23.10 19:00 UTC): уходит только ему
    const b = await rider(h, 'b@example.com');
    await enter(h, b.auth, raceId);
    expect((await raceTicket(h, b.auth, raceId)).status).toBe(200);
    await putReminders(raceId, [{ id: reminderId, offsetHours: 12, text: 'Новый' }]);
    travelTo(h, new Date(START.getTime() - 12 * HOUR));
    await dispatchDue();
    const events = await reminderEvents();
    expect(events).toHaveLength(2);
    expect(await sentOf(a!.userId)).toHaveLength(1);
    expect(await sentOf(b.userId)).toEqual([
      expect.objectContaining({
        reminderId,
        dispatchId: (events[1]!.payload as { dispatchId: string }).dispatchId,
      }),
    ]);

    // удалили правило — регламент его не шлёт (новый id — новая отправка, явно)
    await putReminders(raceId, []);
    travelTo(h, new Date(START.getTime() - HOUR));
    await dispatchDue();
    expect(await reminderEvents()).toHaveLength(2);
  });
});

describe('старт календаря', () => {
  it('регистрация → напоминание за 2 ч от старта календаря', async () => {
    const { admin } = await raceWorld(h);
    const id = await calendarStart(h, admin.token);
    await enableCalendarTickets(h, admin.token, id, {
      reminders: [{ offsetHours: 2, text: 'Через два часа' }],
    });
    const a = await rider(h, 'a@example.com');
    expect((await registerFor(h, a.auth, id)).status).toBe(201);
    travelTo(h, new Date('2026-11-01T05:00:00Z'));
    await dispatchDue();
    const events = await reminderEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ kind: 'calendar', eventId: id });
    expect(await sentOf(a.userId)).toHaveLength(1);
  });
});

describe('приём уведомлений: центр, push, e-mail (RC-D6, RC-D7, RC-D9)', () => {
  const codeOf = async (userId: string) => (await ticketsDb(h).tickets.findOne({ userId }))!.code;

  it('каждому — своё уведомление с целью-билетом; тумблеры «Мероприятия»; письмо с кнопкой; повтор — без дублей', async () => {
    const { riders } = await raceWithReminders(['a@example.com', 'b@example.com']);
    const [a, b] = riders;
    const off = await call(
      h,
      'PUT',
      '/v1/notifications/settings/events',
      { push: false, email: false },
      a!.auth,
    );
    expect(off.status).toBe(200);
    travelTo(h, DUE_24);
    await dispatchDue();
    const intake = notificationsIntake(h);
    expect(await intake.drain()).toEqual(['written']);

    const [noticeA] = await notificationsOf(h, a!.userId);
    const [noticeB] = await notificationsOf(h, b!.userId);
    for (const [notice, who] of [
      [noticeA, a],
      [noticeB, b],
    ] as const) {
      expect(notice).toMatchObject({
        kind: 'event_reminder',
        group: 'events',
        title: 'Скоро старт',
        body: '«Минское кольцо» — 24 октября, 10:00, Парк Победы.\nПаспорт',
        target: { type: 'ticket', code: await codeOf(who!.userId) },
      });
    }
    expect(noticeA).toMatchObject({
      push: { state: 'skipped', reason: 'disabled' },
      email: { state: 'skipped' },
    });
    expect(noticeB).toMatchObject({ push: { state: 'pending' }, email: { state: 'pending' } });

    expect(await runEmail(h, noticeB!._id)).toBe('sent');
    const mail = h.mailer.sent.at(-1)!;
    expect(mail.subject).toBe('Скоро старт');
    expect(mail.html).toContain(`href="${ORIGIN}/tickets/${await codeOf(b!.userId)}"`);
    expect(mail.text).toContain('Паспорт');

    // повтор задачи приёма — без новых уведомлений
    const [event] = await reminderEvents();
    expect(await runIntake(h, TICKETS_REMINDER_DUE, event!._id)).toBe('unchanged');
    expect(await notificationsDb(h).notifications.countDocuments()).toBe(2);
    // центр уведомлений приложения отдаёт цель
    // access-токен истёк за время перевода часов — вход заново
    const list = await call(h, 'GET', '/v1/notifications', undefined, await signIn(h, a!.email));
    expect((list.body as { items: { target: unknown }[] }).items[0]!.target).toEqual({
      type: 'ticket',
      code: await codeOf(a!.userId),
    });
  });

  it('удалённый аккаунт — без уведомления; правило удалено до приёма — gone; событие началось — state', async () => {
    const { raceId, riders } = await raceWithReminders(['a@example.com', 'b@example.com']);
    travelTo(h, DUE_24);
    await dispatchDue();
    await collections(h).users.updateOne(
      { _id: riders[1]!.userId },
      { $set: { deletedAt: h.clock.now() } },
    );
    const [event] = await reminderEvents();
    expect(await runIntake(h, TICKETS_REMINDER_DUE, event!._id)).toBe('written');
    expect(await notificationsOf(h, riders[0]!.userId)).toHaveLength(1);
    expect(await notificationsOf(h, riders[1]!.userId)).toHaveLength(0);

    await notificationsDb(h).notifications.deleteMany({});
    const ticketing = await ticketsDb(h).ticketing.findOne({ eventId: raceId });
    await ticketsDb(h).ticketing.updateOne({ eventId: raceId }, { $set: { reminders: [] } });
    expect(await runIntake(h, TICKETS_REMINDER_DUE, event!._id)).toBe('skipped');
    await ticketsDb(h).ticketing.updateOne(
      { eventId: raceId },
      { $set: { reminders: ticketing!.reminders! } },
    );
    travelTo(h, START);
    expect(await runIntake(h, TICKETS_REMINDER_DUE, event!._id)).toBe('skipped');
    expect(await notificationsDb(h).notifications.countDocuments()).toBe(0);
  });
});
