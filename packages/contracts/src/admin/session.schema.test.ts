import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH } from '../auth/registration.schema.ts';
import { SESSION_COOKIE } from '../auth/session.schema.ts';
import {
  PANEL_SESSION_COOKIE,
  PanelMe,
  PanelSignInRequest,
  PanelSignInResponse,
} from './session.schema.ts';

const USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const me = {
  user: { id: USER_ID, displayName: 'Ольга', email: 'olga@example.by', role: 'admin' },
  permissions: ['members.read', 'members.manage', 'audit.read'],
};

const fieldCodes = (input: unknown) => {
  const result = PanelSignInRequest.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

describe('PanelSignInRequest', () => {
  it('e-mail и пароль; пробелы по краям e-mail срезаются', () => {
    expect(PanelSignInRequest.parse({ email: ' Olga@Example.by ', password: 'x' })).toEqual({
      email: 'Olga@Example.by',
      password: 'x',
    });
  });

  it('пустой пароль — REQUIRED, 129 символов — TOO_LONG', () => {
    expect(fieldCodes({ email: 'a@b.by', password: '' })).toEqual([['password', 'REQUIRED']]);
    expect(fieldCodes({ email: 'a@b.by', password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) })).toEqual([
      ['password', 'TOO_LONG'],
    ]);
  });

  it('лишний ключ (в том числе транспорт сессии приложения) и объект-оператор — ошибка', () => {
    expect(
      PanelSignInRequest.safeParse({ email: 'a@b.by', password: 'x', sessionTransport: 'cookie' })
        .success,
    ).toBe(false);
    expect(PanelSignInRequest.safeParse({ email: { $ne: null }, password: 'x' }).success).toBe(
      false,
    );
  });
});

describe('PanelSignInResponse', () => {
  it('signedIn — с PanelMe', () => {
    expect(PanelSignInResponse.parse({ state: 'signedIn', me })).toEqual({ state: 'signedIn', me });
  });

  it('verificationRequired — токен регистрации, адрес и пауза повтора', () => {
    const pending = {
      state: 'verificationRequired',
      registrationToken: 'r'.repeat(43),
      email: 'olga@example.by',
      resendAvailableInSec: 0,
    };
    expect(PanelSignInResponse.parse(pending)).toEqual(pending);
    expect(PanelSignInResponse.safeParse({ ...pending, registrationToken: 'short' }).success).toBe(
      false,
    );
  });
});

describe('PanelMe', () => {
  it('неизвестная роль или право — ошибка; лишние поля сервера отбрасываются', () => {
    expect(PanelMe.safeParse({ ...me, permissions: ['races.manage'] }).success).toBe(false);
    expect(PanelMe.safeParse({ ...me, user: { ...me.user, role: 'owner' } }).success).toBe(false);
    expect(PanelMe.parse({ ...me, user: { ...me.user, version: 3 } })).toEqual(me);
  });
});

describe('PANEL_SESSION_COOKIE', () => {
  it('своё имя и узкий путь панели — не пересекается с cookie сессии приложения', () => {
    expect(PANEL_SESSION_COOKIE).toEqual({ name: '__Secure-pokatim_admin_sid', path: '/v1/admin' });
    expect(PANEL_SESSION_COOKIE.name).not.toBe(SESSION_COOKIE.name);
    expect(SESSION_COOKIE.path.startsWith(PANEL_SESSION_COOKIE.path)).toBe(false);
  });
});
