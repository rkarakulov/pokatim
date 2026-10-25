import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS, AuditAction, AuditPage, AuditQuery } from './audit.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('AuditAction', () => {
  it('действия — в установленном порядке; новые только в конец (R6)', () => {
    expect(AUDIT_ACTIONS).toEqual([
      'panel.role_granted',
      'panel.role_changed',
      'panel.role_revoked',
      'panel.signed_in',
      'panel.signed_out',
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
          details: { roleTo: 'admin' },
        },
        {
          id: ID,
          at: '2026-10-25T10:00:00.000Z',
          action: 'panel.signed_in',
          actor: { kind: 'user', userId: ID, displayName: 'Ольга' },
          target: null,
          reason: null,
          details: null,
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
