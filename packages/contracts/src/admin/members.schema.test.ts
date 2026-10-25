import { describe, expect, it } from 'vitest';

import {
  ActionReason,
  ChangeRoleRequest,
  DisplayName,
  GrantRoleRequest,
  PanelMember,
  PanelMemberList,
  RevokeRoleRequest,
} from './members.schema.ts';

const USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

const codes = (schema: { safeParse(input: unknown): unknown }, input: unknown) => {
  const result = schema.safeParse(input) as
    | { success: true }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

describe('DisplayName', () => {
  it('1–80 символов после обрезки пробелов', () => {
    expect(DisplayName.parse('  Ольга Н.  ')).toBe('Ольга Н.');
    expect(codes(DisplayName, '   ')).toEqual([['', 'REQUIRED']]);
    expect(codes(DisplayName, 'я'.repeat(81))).toEqual([['', 'TOO_LONG']]);
    expect(DisplayName.safeParse('я'.repeat(80)).success).toBe(true);
  });

  it('управляющие символы, в том числе перевод строки, — INVALID', () => {
    expect(codes(DisplayName, 'Оль\u0000га')).toEqual([['', 'INVALID']]);
    expect(codes(DisplayName, 'Оль\nга')).toEqual([['', 'INVALID']]);
    expect(codes(DisplayName, 'Оль\u007fга')).toEqual([['', 'INVALID']]);
  });
});

describe('ActionReason', () => {
  it('3–500 символов: 2 и 501 — ошибка', () => {
    expect(codes(ActionReason, 'ок')).toEqual([['', 'TOO_SHORT']]);
    expect(codes(ActionReason, 'я'.repeat(501))).toEqual([['', 'TOO_LONG']]);
    expect(ActionReason.parse('  ушла из команды  ')).toBe('ушла из команды');
    expect(ActionReason.safeParse('я'.repeat(500)).success).toBe(true);
  });

  it('перевод строки разрешён, остальные управляющие — INVALID', () => {
    expect(ActionReason.parse('строка 1\nстрока 2')).toBe('строка 1\nстрока 2');
    expect(codes(ActionReason, 'строка\tтаб')).toEqual([['', 'INVALID']]);
    expect(codes(ActionReason, 'строка\r\nдве')).toEqual([['', 'INVALID']]);
    expect(codes(ActionReason, 'нуль\u0000байт')).toEqual([['', 'INVALID']]);
  });
});

describe('запросы «Сотрудники»', () => {
  it('выдача: e-mail, имя, роль; лишний ключ и оператор — ошибка', () => {
    const grant = { email: 'a@b.by', displayName: 'Ольга', role: 'moderator' };
    expect(GrantRoleRequest.parse(grant)).toEqual(grant);
    expect(GrantRoleRequest.safeParse({ ...grant, reason: 'зачем' }).success).toBe(false);
    expect(GrantRoleRequest.safeParse({ ...grant, email: { $ne: null } }).success).toBe(false);
    expect(GrantRoleRequest.safeParse({ ...grant, role: 'owner' }).success).toBe(false);
  });

  it('смена и снятие — причина обязательна', () => {
    expect(codes(ChangeRoleRequest, { role: 'admin' })).toEqual([['reason', 'REQUIRED']]);
    expect(codes(RevokeRoleRequest, {})).toEqual([['reason', 'REQUIRED']]);
    expect(RevokeRoleRequest.parse({ reason: 'ушла из команды' })).toEqual({
      reason: 'ушла из команды',
    });
  });
});

describe('PanelMember', () => {
  it('ответ сервера: статус и даты', () => {
    const member = {
      userId: USER_ID,
      displayName: 'Ольга',
      email: 'olga@example.by',
      role: 'admin',
      status: 'revoked',
      grantedAt: '2026-10-25T10:00:00.000Z',
      revokedAt: '2026-10-25T11:00:00.000Z',
    };
    expect(PanelMemberList.parse({ items: [member], truncated: false })).toEqual({
      items: [member],
      truncated: false,
    });
    expect(PanelMember.safeParse({ ...member, status: 'blocked' }).success).toBe(false);
  });
});
