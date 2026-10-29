import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH } from '../auth/registration.schema.ts';
import { SESSION_COOKIE } from '../auth/session.schema.ts';
import {
  PANEL_DEVICE_COOKIE,
  PANEL_SESSION_COOKIE,
  PanelMe,
  PanelSignedInWithRecoveryCodes,
  PanelSignInRequest,
  PanelSignInResponse,
} from './session.schema.ts';

const USER_ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const me = {
  user: {
    id: USER_ID,
    displayName: 'Ольга',
    email: 'olga@example.by',
    role: 'admin',
    totp: { enabled: true, required: false },
  },
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

describe('PanelSignInResponse — 2FA (panel-2fa)', () => {
  const challenge = 'c'.repeat(43);

  it('totpRequired и totpSetupRequired — вызов и срок; без токена вызова — ошибка', () => {
    for (const state of ['totpRequired', 'totpSetupRequired'] as const) {
      const step = { state, challenge, expiresInSec: 300 };
      expect(PanelSignInResponse.parse(step)).toEqual(step);
      expect(PanelSignInResponse.safeParse({ ...step, challenge: 'short' }).success).toBe(false);
      expect(PanelSignInResponse.safeParse({ state, expiresInSec: 300 }).success).toBe(false);
    }
  });

  it('подтверждение подключения на входе — PanelMe и ровно 10 кодов', () => {
    const codes = Array.from({ length: 10 }, (_, i) => `abcde-fgh${i % 8}2`);
    const body = { state: 'signedIn', me, recoveryCodes: codes };
    expect(PanelSignedInWithRecoveryCodes.parse(body)).toEqual(body);
    expect(
      PanelSignedInWithRecoveryCodes.safeParse({ ...body, recoveryCodes: codes.slice(1) }).success,
    ).toBe(false);
  });
});

describe('PanelMe', () => {
  it('totp обязателен (панель деплоится с API)', () => {
    expect(PanelMe.safeParse({ ...me, user: { ...me.user, totp: undefined } }).success).toBe(false);
  });

  it('неизвестная роль или право — ошибка; лишние поля сервера отбрасываются', () => {
    expect(PanelMe.safeParse({ ...me, permissions: ['routes.manage'] }).success).toBe(false);
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

  it('cookie устройства — своё имя, путь только сессии панели (вход)', () => {
    expect(PANEL_DEVICE_COOKIE).toEqual({
      name: '__Secure-pokatim_admin_device',
      path: '/v1/admin/session',
    });
    expect(PANEL_DEVICE_COOKIE.path.startsWith(PANEL_SESSION_COOKIE.path)).toBe(true);
    expect(PANEL_DEVICE_COOKIE.name).not.toBe(PANEL_SESSION_COOKIE.name);
  });
});
