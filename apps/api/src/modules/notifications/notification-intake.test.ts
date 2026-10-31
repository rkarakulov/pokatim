import { describe, expect, it } from 'vitest';

import type { AchievementNotice, AchievementNotices } from '../achievements';
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
    unused as AchievementNotices,
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
    const intake = new NotificationIntake(unused, unused, unused, unused, unused, tickets, unused);
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

describe('NotificationIntake: сброс поля профиля (profile-moderation-followups, RC-F3 — без порта)', () => {
  const RESET = 'profile.field-reset';
  const USER = '0190a6f4-0000-7000-8000-000000000003';
  const AT = '2026-10-30T09:00:00.000Z';
  const payload = (field: string, avatarBlockedUntil: string | null = null) => ({
    userId: USER,
    field,
    resetAt: AT,
    seq: 7,
    avatarBlockedUntil,
  });

  it.each([
    ['name', { kind: 'profile_name_reset' }],
    ['club', { kind: 'profile_club_reset' }],
    ['avatar', { kind: 'profile_avatar_reset', blockedUntil: null }],
  ] as const)(
    '%s — самому райдеру, цель — свой профиль, схлопывание по полю',
    async (field, text) => {
      expect(await intakeWith(null).drafts(RESET, payload(field), NOW)).toEqual([
        {
          text,
          target: { type: 'profile-edit' },
          collapse: { key: `profile:${USER}:${field}`, seq: 7 },
          recipients: [USER],
        },
      ]);
    },
  );

  it('фото с запретом — срок в тексте', async () => {
    const until = '2026-11-29T09:00:00.000Z';
    const drafts = await intakeWith(null).drafts(RESET, payload('avatar', until), NOW);
    expect(drafts).toMatchObject([
      { text: { kind: 'profile_avatar_reset', blockedUntil: new Date(until) } },
    ]);
  });

  it.each([
    ['поле вне справочника', payload('theme')],
    ['лишний ключ (причина модератора)', { ...payload('name'), reason: 'мат' }],
    ['нет avatarBlockedUntil', { userId: USER, field: 'name', resetAt: AT, seq: 7 }],
    // ревью pass 2: порядок — только ревизия сбросов профиля; событие без неё не схлопывается «по времени»
    ['нет seq', { userId: USER, field: 'name', resetAt: AT, avatarBlockedUntil: null }],
    ['seq не положительный', { ...payload('name'), seq: 0 }],
    ['битый userId', { ...payload('name'), userId: 'x' }],
  ])('%s — invalid_payload', async (_name, bad) => {
    expect(await intakeWith(null).drafts(RESET, bad, NOW)).toBe('invalid_payload');
  });
});

describe('NotificationIntake: новое достижение (achievements-push, 5.B)', () => {
  const GRANTED = 'achievements.grant-noticed';
  const GRANT = '0190a6f4-0000-7000-8000-000000000011';
  const RIDER = '0190a6f4-0000-7000-8000-000000000012';
  const SEASON = '0190a6f4-0000-7000-8000-000000000013';
  const payload = (overrides: Record<string, unknown> = {}) => ({
    grant: 'fact',
    grantId: GRANT,
    level: 2,
    origin: 'server',
    ...overrides,
  });

  function intakeWithAchievements(result: AchievementNotice | 'gone' | 'state') {
    const achievements: AchievementNotices = { notice: async () => result };
    const unused = {} as never;
    return new NotificationIntake(unused, unused, unused, unused, unused, unused, achievements);
  }
  const notice: AchievementNotice = {
    userId: RIDER,
    code: 'races_5',
    level: 2,
    object: { kind: 'race', title: 'Гран-при' },
    seasonId: null,
  };

  it('битый payload — invalid_payload; gone/state порта — как есть', async () => {
    const intake = intakeWithAchievements(notice);
    for (const bad of [
      {},
      payload({ origin: 'panel' }),
      payload({ level: 4 }),
      payload({ grantId: 'x' }),
    ]) {
      expect(await intake.drafts(GRANTED, bad, NOW)).toBe('invalid_payload');
    }
    expect(await intakeWithAchievements('gone').drafts(GRANTED, payload(), NOW)).toBe('gone');
    expect(await intakeWithAchievements('state').drafts(GRANTED, payload(), NOW)).toBe('state');
  });

  it('владельцу выдачи: текст, цель achievement, схлопывание по выдаче и рангу; server — с push', async () => {
    expect(await intakeWithAchievements(notice).drafts(GRANTED, payload(), NOW)).toEqual([
      {
        text: {
          kind: 'achievement_granted',
          code: 'races_5',
          level: 2,
          objectKind: 'race',
          objectTitle: 'Гран-при',
        },
        target: { type: 'achievement', code: 'races_5' },
        collapse: { key: `achievement:${GRANT}`, seq: 2 },
        recipients: [RIDER],
        inApp: false,
      },
    ]);
  });

  it('read — в центр без push (inApp); сезонное — цель с seasonId, ранг схлопывания 1', async () => {
    const seasonal: AchievementNotice = {
      userId: RIDER,
      code: 'season_champion',
      level: null,
      object: { kind: 'season', title: 'Сезон 2026' },
      seasonId: SEASON,
    };
    const [draft] = (await intakeWithAchievements(seasonal).drafts(
      GRANTED,
      payload({ grant: 'season', level: null, origin: 'read' }),
      NOW,
    )) as Exclude<Awaited<ReturnType<NotificationIntake['drafts']>>, string>;
    expect(draft).toMatchObject({
      target: { type: 'achievement', code: 'season_champion', seasonId: SEASON },
      collapse: { key: `achievement:${GRANT}`, seq: 1 },
      inApp: true,
    });
  });
});
