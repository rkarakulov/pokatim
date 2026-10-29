import { TicketCode } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { EventTicketingDoc } from './tickets.collection';
import {
  canIssue,
  checkInWindow,
  type EventFacts,
  eventAccess,
  generateTicketCode,
  isPast,
  maskEmail,
  type PlanEntry,
  raceReconcilePlan,
  registrationGate,
  ticketStatus,
} from './tickets.policy';

const HOUR = 3_600_000;
const START = new Date('2026-11-01T07:00:00Z');
const at = (hours: number) => new Date(START.getTime() + hours * HOUR);

const ticketing = (enabled = true): EventTicketingDoc => ({
  _id: 'race:r',
  kind: 'race',
  eventId: 'r',
  enabled,
  startsAt: START,
  endsAt: null,
  place: 'Парк',
  address: null,
  instructions: null,
  capacity: null,
  registeredCount: 0,
  version: 1,
  updatedAt: START,
  updatedBy: 'staff',
});

const event = (overrides: Partial<EventFacts> = {}): EventFacts => ({
  kind: 'race',
  id: 'r',
  title: 'Гонка',
  state: 'scheduled',
  published: true,
  startsAt: START,
  endsAt: null,
  place: 'Парк',
  address: null,
  city: null,
  distancesKm: [],
  ownerUserId: 'owner',
  ticketing: ticketing(),
  ...overrides,
});

describe('код билета', () => {
  it('10 символов Crockford — проходит схему контракта; коды разные', () => {
    const codes = new Set(Array.from({ length: 500 }, generateTicketCode));
    expect(codes.size).toBe(500);
    for (const code of codes) expect(TicketCode.parse(code)).toBe(code);
  });
});

describe('окно check-in и «прошло» ([ASSUMPTION] −24 ч … endsAt ?? +12 ч)', () => {
  it('без конца события — 12 ч после старта; с концом — конец', () => {
    expect(checkInWindow(event())).toEqual({ opensAt: at(-24), closesAt: at(12) });
    expect(checkInWindow(event({ endsAt: at(5) })).closesAt).toEqual(at(5));
  });

  it('прошло — с границы закрытия включительно', () => {
    expect(isPast(event(), at(11.99))).toBe(false);
    expect(isPast(event(), at(12))).toBe(true);
  });
});

describe('статус билета', () => {
  it('отменён райдером и отмечен — как хранится; отмена события — event_cancelled', () => {
    expect(ticketStatus({ status: 'cancelled' }, event({ state: 'cancelled' }))).toBe('cancelled');
    expect(ticketStatus({ status: 'checked_in' }, event({ state: 'cancelled' }))).toBe(
      'checked_in',
    );
    expect(ticketStatus({ status: 'active' }, event({ state: 'cancelled' }))).toBe(
      'event_cancelled',
    );
    expect(ticketStatus({ status: 'active' }, event())).toBe('active');
  });

  it('выпуск: только включённые билеты, событие по плану, до закрытия окна (RC-T4)', () => {
    expect(canIssue(event(), at(1))).toBe(true);
    expect(canIssue(event({ ticketing: ticketing(false) }), at(1))).toBe(false);
    expect(canIssue(event({ ticketing: null }), at(1))).toBe(false);
    expect(canIssue(event({ state: 'cancelled' }), at(1))).toBe(false);
    expect(canIssue(event(), at(12))).toBe(false);
  });
});

describe('план сверки гонки', () => {
  const verified: PlanEntry['category'] = { kind: 'race', tier: 'verified', groupKey: 'm_u40' };
  const start: PlanEntry['category'] = { kind: 'race', tier: 'start', groupKey: 'overall' };
  const entry = (id: string, status: PlanEntry['status'], category = start): PlanEntry => ({
    entryId: id,
    userId: `u-${id}`,
    status,
    category,
  });
  const ticket = (id: string, status: 'active' | 'checked_in' | 'cancelled', category = start) => ({
    _id: `t-${id}`,
    registrationId: id,
    status,
    category,
  });

  it('выпуск активным без билета, отмена снятым, новая категория — без нового билета (RC-T5)', () => {
    const plan = raceReconcilePlan(
      [
        entry('a', 'active'),
        entry('b', 'withdrawn'),
        entry('c', 'active', verified),
        entry('d', 'withdrawn'),
        entry('e', 'withdrawn'),
      ],
      [
        ticket('b', 'active'),
        ticket('c', 'active'),
        ticket('d', 'cancelled'),
        ticket('e', 'checked_in'),
      ],
      event(),
      at(1),
    );
    expect(plan).toEqual({
      issue: [entry('a', 'active')],
      cancel: ['t-b'],
      recategorize: [{ ticketId: 't-c', category: verified }],
    });
  });

  it('отменённый билет не воскрешается; выключены или прошло — без выпуска, отмена — да', () => {
    expect(
      raceReconcilePlan([entry('a', 'active')], [ticket('a', 'cancelled')], event(), at(1)),
    ).toEqual({ issue: [], cancel: [], recategorize: [] });
    const off = event({ ticketing: ticketing(false) });
    expect(
      raceReconcilePlan(
        [entry('a', 'active'), entry('b', 'withdrawn')],
        [ticket('b', 'active')],
        off,
        at(1),
      ),
    ).toEqual({ issue: [], cancel: ['t-b'], recategorize: [] });
    expect(raceReconcilePlan([entry('a', 'active')], [], event(), at(12)).issue).toEqual([]);
  });
});

describe('регистрация на старт календаря', () => {
  const calendar = (overrides: Partial<EventFacts> = {}) =>
    event({ kind: 'calendar', ownerUserId: null, ...overrides });

  it('снят — unpublished; выключено — not_enabled; с момента старта — started', () => {
    expect(registrationGate(calendar({ published: false, state: 'cancelled' }), at(-1))).toBe(
      'unpublished',
    );
    expect(registrationGate(calendar({ ticketing: ticketing(false) }), at(-1))).toBe('not_enabled');
    expect(registrationGate(calendar(), at(0))).toBe('started');
    expect(registrationGate(calendar(), at(-0.01))).toBeNull();
  });
});

describe('доступ сотрудника к событию (RC-T9)', () => {
  const admin = {
    userId: 'admin',
    permissions: ['races.manage', 'races.manage_any', 'calendar.manage', 'tickets.checkin'],
  } as const;
  const organizer = { userId: 'owner', permissions: ['races.manage', 'tickets.checkin'] } as const;
  const moderator = { userId: 'mod', permissions: ['races.read'] } as const;

  it('настройки: организатор — своя гонка, чужая — 404, календарь — 403; модератор — 403', () => {
    expect(eventAccess(organizer, 'race', 'manage', 'owner')).toBe('ok');
    expect(eventAccess(organizer, 'race', 'manage', 'other')).toBe('not_found');
    expect(eventAccess(organizer, 'calendar', 'manage', null)).toBe('forbidden');
    expect(eventAccess(moderator, 'race', 'manage', 'owner')).toBe('forbidden');
    expect(eventAccess(admin, 'race', 'manage', 'other')).toBe('ok');
    expect(eventAccess(admin, 'calendar', 'manage', null)).toBe('ok');
  });

  it('check-in: чужая гонка и старт календаря у организатора — 404', () => {
    expect(eventAccess(organizer, 'race', 'checkin', 'owner')).toBe('ok');
    expect(eventAccess(organizer, 'race', 'checkin', 'other')).toBe('not_found');
    expect(eventAccess(organizer, 'calendar', 'checkin', null)).toBe('not_found');
    expect(eventAccess(admin, 'calendar', 'checkin', null)).toBe('ok');
  });
});

describe('маска e-mail', () => {
  it('первая буква и домен', () => {
    expect(maskEmail('rider@gmail.com')).toBe('r***@gmail.com');
    expect(maskEmail('broken')).toBe('***');
  });
});
