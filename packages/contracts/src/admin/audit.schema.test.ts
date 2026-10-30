import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  AUDIT_SUBJECT_KINDS,
  AuditAction,
  AuditPage,
  AuditQuery,
} from './audit.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('AuditAction', () => {
  it('действия — в установленном порядке; новые только в конец (R6)', () => {
    expect(AUDIT_ACTIONS).toEqual([
      'panel.role_granted',
      'panel.role_changed',
      'panel.role_revoked',
      'panel.signed_in',
      'panel.signed_out',
      'season.created',
      'season.updated',
      'race.created',
      'race.updated',
      'race.published',
      'race.cancelled',
      'race.discarded',
      'calendar.created',
      'calendar.updated',
      'calendar.unpublished',
      'calendar.republished',
      'route.created',
      'results.attempt_excluded',
      'results.attempt_restored',
      'results.recheck_requested',
      'results.protocol_published',
      'results.result_disqualified',
      'results.disqualification_revoked',
      'results.recalculation_applied',
      'ride.hidden',
      'ride.restored',
      'ride.reports_dismissed',
      'disputes.decided',
      'disputes.series_viewed',
      'profile.name_reset',
      'route.published',
      'route.unpublished',
      'route.catalog_updated',
      'account.deleted',
      'appearance.theme_changed',
      'profile.verified_demographics_changed',
      'route.submission_approved',
      'route.submission_rejected',
      'route.rider_hidden',
      'route.rider_restored',
      'route.rider_reports_dismissed',
      'appearance.decor_changed',
      'profile.avatar_reset',
      'profile.club_reset',
      'profile.reports_dismissed',
      'tickets.settings_updated',
      'tickets.checked_in',
      'tickets.material_added',
      'tickets.material_updated',
      'tickets.material_removed',
      'tickets.materials_reordered',
      'account.erasure_retried',
      'panel.totp_enabled',
      'panel.totp_disabled',
      'panel.totp_reset',
      'panel.totp_recovery_regenerated',
      'panel.totp_recovery_used',
      'panel.invitation_sent',
      'panel.invitation_revoked',
      'panel.invitation_accepted',
      'profile.avatar_unblocked',
    ]);
    expect(AUDIT_SUBJECT_KINDS).toEqual([
      'season',
      'race',
      'calendar_start',
      'route',
      'ride',
      'rider',
      'platform',
      'invitation',
    ]);
    expect(AuditAction.safeParse('panel.deleted').success).toBe(false);
  });
});

describe('AuditQuery', () => {
  it('по умолчанию limit 20; строковые параметры query приводятся', () => {
    expect(AuditQuery.parse({})).toEqual({ limit: 20 });
    expect(AuditQuery.parse({ limit: '50', cursor: ID, action: 'panel.signed_in' })).toEqual({
      limit: 50,
      cursor: ID,
      action: 'panel.signed_in',
    });
  });

  it('cursor не UUID, limit 0/101, неизвестное действие — ошибка', () => {
    expect(AuditQuery.safeParse({ cursor: 'abc' }).success).toBe(false);
    expect(AuditQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(AuditQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(AuditQuery.safeParse({ action: 'panel.x' }).success).toBe(false);
    expect(AuditQuery.safeParse({ actorUserId: 'me' }).success).toBe(false);
    expect(AuditQuery.safeParse({ subjectId: 'me' }).success).toBe(false);
    expect(AuditQuery.parse({ subjectId: ID })).toEqual({ limit: 20, subjectId: ID });
  });

  it('лишний параметр (в том числе `action[$ne]`) и объект вместо строки — ошибка', () => {
    expect(AuditQuery.safeParse({ 'action[$ne]': 'x' }).success).toBe(false);
    expect(AuditQuery.safeParse({ action: { $ne: 'x' } }).success).toBe(false);
  });
});

describe('AuditPage', () => {
  it('записи пользователя и CLI; цель и детали могут отсутствовать', () => {
    const page = {
      items: [
        {
          id: ID,
          at: '2026-10-25T10:00:00.000Z',
          action: 'panel.role_granted',
          actor: { kind: 'cli' },
          target: { userId: ID, displayName: 'Ольга' },
          reason: null,
          subject: null,
          details: { roleTo: 'admin' },
        },
        {
          id: ID,
          at: '2026-10-25T10:00:00.000Z',
          action: 'panel.signed_in',
          actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
          target: null,
          reason: null,
          subject: null,
          details: null,
        },
        {
          id: ID,
          at: '2026-10-25T10:00:00.000Z',
          action: 'race.cancelled',
          actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
          target: null,
          reason: null,
          subject: { kind: 'race', id: ID, label: 'Минское кольцо' },
          details: { cancelReason: 'weather' },
        },
        {
          id: ID,
          at: '2026-10-25T10:00:00.000Z',
          action: 'season.updated',
          actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
          target: null,
          reason: null,
          subject: { kind: 'season', id: ID, label: 'Сезон 2026' },
          details: { changedFields: ['name', 'endsOn'] },
        },
      ],
      nextCursor: null,
    };
    expect(AuditPage.parse(page)).toEqual(page);
    expect(
      AuditPage.safeParse({ ...page, items: [{ ...page.items[0], actor: { kind: 'robot' } }] })
        .success,
    ).toBe(false);
  });
});

describe('AuditEntry — модерация райдов (05b)', () => {
  it('объект ride и число закрытых жалоб', () => {
    const entry = {
      id: ID,
      at: '2026-10-25T10:00:00.000Z',
      action: 'ride.hidden',
      actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
      target: null,
      reason: 'Оскорбления в описании',
      subject: { kind: 'ride', id: ID, label: 'Кофе-райд' },
      details: { reportCount: 2 },
    };
    expect(AuditPage.parse({ items: [entry], nextCursor: null }).items[0]).toEqual(entry);
    expect(
      AuditPage.safeParse({
        items: [{ ...entry, details: { reportCount: -1 } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe('AuditEntry — решение по спору (06)', () => {
  it('объект race, детали disputeId и entryId', () => {
    const entry = {
      id: ID,
      at: '2026-10-25T10:00:00.000Z',
      action: 'disputes.decided',
      actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
      target: null,
      reason: 'track_confirmed',
      subject: { kind: 'race', id: ID, label: 'Гонка' },
      details: { disputeId: ID, entryId: ID },
    };
    expect(AuditPage.parse({ items: [entry], nextCursor: null }).items[0]).toEqual(entry);
    expect(
      AuditPage.safeParse({ items: [{ ...entry, details: { disputeId: 'x' } }], nextCursor: null })
        .success,
    ).toBe(false);
  });
});

describe('AuditEntry — объект и детали', () => {
  it('неизвестный вид объекта и причина отмены не из шаблона — ошибка', () => {
    const base = {
      id: ID,
      at: '2026-10-25T10:00:00.000Z',
      action: 'race.cancelled',
      actor: { kind: 'cli' },
      target: null,
      reason: null,
      details: null,
    };
    expect(
      AuditPage.safeParse({
        items: [{ ...base, subject: { kind: 'track', id: ID, label: 'x' } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      AuditPage.safeParse({
        items: [{ ...base, subject: null, details: { cancelReason: 'дождь' } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe('AuditEntry — протокол гонки (race-results-05)', () => {
  it('детали действия результатов: попытка, заявка, ревизия; ревизия — целое', () => {
    const entry = {
      id: ID,
      at: '2026-10-28T10:00:00.000Z',
      action: 'results.result_disqualified',
      actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
      target: null,
      reason: 'Срезка маршрута',
      subject: { kind: 'race', id: ID, label: 'Минское кольцо' },
      details: { attemptId: ID, entryId: ID, revision: 2 },
    };
    expect(AuditPage.parse({ items: [entry], nextCursor: null }).items[0]?.details).toEqual({
      attemptId: ID,
      entryId: ID,
      revision: 2,
    });
    expect(
      AuditPage.safeParse({
        items: [{ ...entry, details: { revision: 1.5 } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      AuditPage.safeParse({
        items: [{ ...entry, details: { entryId: 'x' } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe('AuditEntry — смена темы приложения (app-themes)', () => {
  const NIL = '00000000-0000-0000-0000-000000000000';
  const entry = {
    id: ID,
    at: '2026-10-27T10:00:00.000Z',
    action: 'appearance.theme_changed',
    actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
    target: null,
    reason: null,
    subject: { kind: 'platform', id: NIL, label: 'Оформление приложения' },
    details: { themeFrom: 'classic', themeTo: 'atlas' },
  };

  it('объект platform (nil UUID) и детали themeFrom/themeTo', () => {
    expect(AuditPage.parse({ items: [entry], nextCursor: null }).items[0]).toEqual(entry);
  });

  it('неизвестная тема в деталях — ошибка', () => {
    expect(
      AuditPage.safeParse({
        items: [{ ...entry, details: { themeFrom: 'classic', themeTo: 'neon' } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe('AuditEntry — модерация маршрутов райдеров (routes-06)', () => {
  const entry = {
    id: ID,
    at: '2026-10-27T10:00:00.000Z',
    action: 'route.submission_rejected',
    actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
    target: null,
    reason: 'Старт у дома',
    subject: { kind: 'route', id: ID, label: 'Кольцо' },
    details: { rejectionReason: 'dangerous' },
  };

  it('причина отклонения — код справочника; неизвестная — ошибка', () => {
    expect(AuditPage.parse({ items: [entry], nextCursor: null }).items[0]).toEqual(entry);
    expect(
      AuditPage.safeParse({
        items: [{ ...entry, details: { rejectionReason: 'boring' } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe('AuditEntry — запрет загрузки фото (profile-moderation-followups)', () => {
  it('details.avatarBlockedUntil — дата ISO, необязательна', () => {
    const entry = {
      id: ID,
      at: '2026-10-30T10:00:00.000Z',
      action: 'profile.avatar_reset',
      actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
      target: null,
      reason: 'Недопустимое фото',
      subject: { kind: 'rider', id: ID, label: 'Участник ·000001' },
      details: { reportCount: 1, avatarBlockedUntil: '2026-11-29T10:00:00.000Z' },
    };
    expect(AuditPage.parse({ items: [entry], nextCursor: null }).items[0]?.details).toEqual({
      reportCount: 1,
      avatarBlockedUntil: '2026-11-29T10:00:00.000Z',
    });
    expect(
      AuditPage.safeParse({
        items: [{ ...entry, details: { avatarBlockedUntil: 'завтра' } }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
