import { describe, expect, it } from 'vitest';

import type { DisputeNotices } from '../disputes';
import type { RaceRegistry } from '../races';
import type { ResultsNotices } from '../results';
import type { RideNotices } from '../rides';
import type { RouteNotices, RoutePublicationNotice } from '../routes';
import type { TicketNotices, TicketReminderNotice } from '../tickets';
import { NotificationIntake } from './notification-intake';

const ROUTE = '0190a6f4-0000-7000-8000-000000000001';
const AUTHOR = '0190a6f4-0000-7000-8000-000000000002';
const DECIDED_AT = new Date('2026-10-28T07:00:00.000Z');
const DECIDED = 'routes.publication-decided';

const event = (decision: 'approved' | 'rejected', decidedAt = DECIDED_AT) => ({
  routeId: ROUTE,
  authorUserId: AUTHOR,
  decision,
  decidedAt: decidedAt.toISOString(),
});

/** Intake с портом маршрутов, отдающим `notice`; прочие порты в этих сценариях не вызываются. */
function intakeWith(notice: Partial<RoutePublicationNotice> | null) {
  const routes: RouteNotices = {
    publication: async () =>
      notice && {
        id: ROUTE,
        title: 'Вокруг моря',
        ownerUserId: AUTHOR,
        status: 'approved',
        decidedAt: DECIDED_AT,
        rejectionReason: null,
        ...notice,
      },
  };
  const unused = {} as never;
  return new NotificationIntake(
    unused as ResultsNotices,
    unused as DisputeNotices,
    unused as RideNotices,
    routes,
    unused as RaceRegistry,
    unused as TicketNotices,
  );
}

const NOW = new Date('2026-10-28T08:00:00.000Z');

describe('NotificationIntake: решение по заявке маршрута (routes-06 A6)', () => {
  it('маршрута нет (удалён, не райдера, не подавался) — gone', async () => {
    expect(await intakeWith(null).drafts(DECIDED, event('approved'), NOW)).toBe('gone');
  });

  it.each(['pending', 'hidden', 'withdrawn', 'rejected'] as const)(
    'одобрение, а заявка уже %s — state',
    async (status) => {
      expect(await intakeWith({ status }).drafts(DECIDED, event('approved'), NOW)).toBe('state');
    },
  );

  it('статус совпал, но решение другое (decidedAt не тот) — state', async () => {
    const later = new Date(DECIDED_AT.getTime() + 1);
    expect(await intakeWith({ decidedAt: later }).drafts(DECIDED, event('approved'), NOW)).toBe(
      'state',
    );
  });

  it('отклонение без кода причины — state', async () => {
    expect(
      await intakeWith({ status: 'rejected', rejectionReason: null }).drafts(
        DECIDED,
        event('rejected'),
        NOW,
      ),
    ).toBe('state');
  });

  it('актуальное отклонение — автору, причина кодом, цель — свой маршрут', async () => {
    expect(
      await intakeWith({ status: 'rejected', rejectionReason: 'duplicate' }).drafts(
        DECIDED,
        event('rejected'),
        NOW,
      ),
    ).toEqual([
      {
        text: { kind: 'route_rejected', route: 'Вокруг моря', reason: 'duplicate' },
        target: { type: 'my-route', routeId: ROUTE },
        collapse: { key: `route:${ROUTE}:publication`, seq: DECIDED_AT.getTime() },
        recipients: [AUTHOR],
      },
    ]);
  });
});

describe('NotificationIntake: напоминание о событии (PR D)', () => {
  const REMINDER = 'tickets.reminder-due';
  const ID = '0190a6f4-0000-7000-8000-000000000003';
  const payload = { kind: 'race', eventId: ID, reminderId: ID, dispatchId: ID };
  const STARTS = new Date('2026-10-29T07:00:00.000Z');

  function intakeWithTickets(result: TicketReminderNotice | 'gone' | 'state') {
    const calls: unknown[][] = [];
    const tickets: TicketNotices = {
      reminder: async (...args) => {
        calls.push(args);
        return result;
      },
    };
    const unused = {} as never;
    const intake = new NotificationIntake(unused, unused, unused, unused, unused, tickets);
    return { intake, calls };
  }

  it('битый payload — invalid_payload; gone/state порта — как есть', async () => {
    expect(await intakeWithTickets('gone').intake.drafts(REMINDER, { kind: 'ride' }, NOW)).toBe(
      'invalid_payload',
    );
    expect(await intakeWithTickets('gone').intake.drafts(REMINDER, payload, NOW)).toBe('gone');
    expect(await intakeWithTickets('state').intake.drafts(REMINDER, payload, NOW)).toBe('state');
  });

  it('один черновик: текст правила, цель — свой билет у каждого получателя', async () => {
    const { intake, calls } = intakeWithTickets({
      event: { title: 'Гонка', startsAt: STARTS, place: 'Парк' },
      text: 'Паспорт',
      recipients: [
        { userId: AUTHOR, code: '7XK2M9PQRT' },
        { userId: ROUTE, code: 'ABCDE12345' },
      ],
    });
    expect(await intake.drafts(REMINDER, payload, NOW)).toEqual([
      {
        text: {
          kind: 'event_reminder',
          event: 'Гонка',
          startsAt: STARTS,
          place: 'Парк',
          text: 'Паспорт',
        },
        target: null,
        targets: new Map([
          [AUTHOR, { type: 'ticket', code: '7XK2M9PQRT' }],
          [ROUTE, { type: 'ticket', code: 'ABCDE12345' }],
        ]),
        recipients: [AUTHOR, ROUTE],
      },
    ]);
    expect(calls).toEqual([[payload, NOW]]);
  });
});
