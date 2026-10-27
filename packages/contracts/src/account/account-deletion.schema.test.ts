import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH } from '../auth/registration.schema.ts';
import { DeleteAccountRequest } from './account-deletion.schema.ts';

const fieldCodes = (input: unknown) => {
  const result = DeleteAccountRequest.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

describe('DeleteAccountRequest', () => {
  it('только пароль; короткий пароль не отвергается (политика длины — у регистрации)', () => {
    expect(DeleteAccountRequest.parse({ password: 'x' })).toEqual({ password: 'x' });
  });

  it('пустой и отсутствующий пароль — REQUIRED, длиннее предела входа — TOO_LONG', () => {
    expect(fieldCodes({ password: '' })).toEqual([['password', 'REQUIRED']]);
    expect(fieldCodes({})).toEqual([['password', 'REQUIRED']]);
    expect(fieldCodes({ password: 'p'.repeat(PASSWORD_MAX_LENGTH) })).toEqual([]);
    expect(fieldCodes({ password: 'p'.repeat(PASSWORD_MAX_LENGTH + 1) })).toEqual([
      ['password', 'TOO_LONG'],
    ]);
  });

  it('лишние ключи (e-mail, userId) — ошибка: пользователь берётся из сессии', () => {
    expect(DeleteAccountRequest.safeParse({ password: 'x', email: 'a@b.by' }).success).toBe(false);
    expect(DeleteAccountRequest.safeParse({ password: 'x', userId: 'u' }).success).toBe(false);
  });
});
