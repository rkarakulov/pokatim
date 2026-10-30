import { describe, expect, it } from 'vitest';

import type { DisputeNotices } from '../disputes';
import type { RaceRegistry } from '../races';
import type { ResultsNotices } from '../results';
import type { RideNotices } from '../rides';
import type { RouteNotices, RoutePublicationNotice } from '../routes';
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
  );
}

describe('NotificationIntake: решение по заявке маршрута (routes-06 A6)', () => {
  it('маршрута нет (удалён, не райдера, не подавался) — gone', async () => {
    expect(await intakeWith(null).drafts(DECIDED, event('approved'))).toBe('gone');
  });

  it.each(['pending', 'hidden', 'withdrawn', 'rejected'] as const)(
    'одобрение, а заявка уже %s — state',
    async (status) => {
      expect(await intakeWith({ status }).drafts(DECIDED, event('approved'))).toBe('state');
    },
  );

  it('статус совпал, но решение другое (decidedAt не тот) — state', async () => {
    const later = new Date(DECIDED_AT.getTime() + 1);
    expect(await intakeWith({ decidedAt: later }).drafts(DECIDED, event('approved'))).toBe('state');
  });

  it('отклонение без кода причины — state', async () => {
    expect(
      await intakeWith({ status: 'rejected', rejectionReason: null }).drafts(
        DECIDED,
        event('rejected'),
      ),
    ).toBe('state');
  });

  it('актуальное отклонение — автору, причина кодом, цель — свой маршрут', async () => {
    expect(
      await intakeWith({ status: 'rejected', rejectionReason: 'duplicate' }).drafts(
        DECIDED,
        event('rejected'),
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

describe('NotificationIntake: сброс поля профиля (profile-moderation-followups, RC-F3 — без порта)', () => {
  const RESET = 'profile.field-reset';
  const USER = '0190a6f4-0000-7000-8000-000000000003';
  const AT = '2026-10-30T09:00:00.000Z';
  const payload = (field: string, avatarBlockedUntil: string | null = null) => ({
    userId: USER,
    field,
    resetAt: AT,
    avatarBlockedUntil,
  });

  it.each([
    ['name', { kind: 'profile_name_reset' }],
    ['club', { kind: 'profile_club_reset' }],
    ['avatar', { kind: 'profile_avatar_reset', blockedUntil: null }],
  ] as const)(
    '%s — самому райдеру, цель — свой профиль, схлопывание по полю',
    async (field, text) => {
      expect(await intakeWith(null).drafts(RESET, payload(field))).toEqual([
        {
          text,
          target: { type: 'profile-edit' },
          collapse: { key: `profile:${USER}:${field}`, seq: Date.parse(AT) },
          recipients: [USER],
        },
      ]);
    },
  );

  it('фото с запретом — срок в тексте', async () => {
    const until = '2026-11-29T09:00:00.000Z';
    const drafts = await intakeWith(null).drafts(RESET, payload('avatar', until));
    expect(drafts).toMatchObject([
      { text: { kind: 'profile_avatar_reset', blockedUntil: new Date(until) } },
    ]);
  });

  it.each([
    ['поле вне справочника', payload('theme')],
    ['лишний ключ (причина модератора)', { ...payload('name'), reason: 'мат' }],
    ['нет avatarBlockedUntil', { userId: USER, field: 'name', resetAt: AT }],
    ['битый userId', { ...payload('name'), userId: 'x' }],
  ])('%s — invalid_payload', async (_name, bad) => {
    expect(await intakeWith(null).drafts(RESET, bad)).toBe('invalid_payload');
  });
});
