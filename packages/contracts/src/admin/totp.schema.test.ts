import { describe, expect, it } from 'vitest';

import {
  RecoveryCode,
  TotpCode,
  TotpCodeRequest,
  TotpDisableRequest,
  TotpResetRequest,
  TotpSetup,
  TotpSetupConfirmRequest,
  TotpSetupStartRequest,
  TotpSignInRequest,
  TotpStatus,
} from './totp.schema.ts';

const challenge = 'c'.repeat(43);

describe('TotpCode и RecoveryCode', () => {
  it('код — ровно 6 цифр', () => {
    expect(TotpCode.parse('012345')).toBe('012345');
    for (const bad of ['12345', '1234567', '12 345', 'abcdef', '']) {
      expect(TotpCode.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('код восстановления — base32 5+5, дефис и регистр по желанию', () => {
    for (const ok of ['abcde-fgh27', 'ABCDEFGH27', 'abcdefgh27']) {
      expect(RecoveryCode.safeParse(ok).success, ok).toBe(true);
    }
    // 0 1 8 9 — не base32; длина; лишние дефисы
    for (const bad of ['abcde-fgh10', 'abcde-fgh89', 'abcd-efgh2', 'abcde--fgh27', 'abcde-fgh277']) {
      expect(RecoveryCode.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('TotpSignInRequest (sign-in/totp)', () => {
  it('ровно одно из code и recoveryCode; rememberDevice по умолчанию false', () => {
    expect(TotpSignInRequest.parse({ challenge, code: '123456' })).toEqual({
      challenge,
      code: '123456',
      rememberDevice: false,
    });
    expect(
      TotpSignInRequest.parse({ challenge, recoveryCode: 'abcde-fgh27', rememberDevice: true }),
    ).toEqual({ challenge, recoveryCode: 'abcde-fgh27', rememberDevice: true });
    expect(
      TotpSignInRequest.safeParse({ challenge, code: '123456', recoveryCode: 'abcde-fgh27' }).success,
    ).toBe(false);
    expect(TotpSignInRequest.safeParse({ challenge }).success).toBe(false);
  });

  it('strict: лишний ключ, оператор, короткий вызов — ошибка', () => {
    expect(TotpSignInRequest.safeParse({ challenge, code: '123456', password: 'x' }).success).toBe(
      false,
    );
    expect(TotpSignInRequest.safeParse({ challenge: { $ne: null }, code: '123456' }).success).toBe(
      false,
    );
    expect(TotpSignInRequest.safeParse({ challenge: 'short', code: '123456' }).success).toBe(false);
  });
});

describe('подключение и настройки', () => {
  it('старт и подтверждение на входе — strict', () => {
    expect(TotpSetupStartRequest.parse({ challenge })).toEqual({ challenge });
    expect(TotpSetupStartRequest.safeParse({ challenge, code: '123456' }).success).toBe(false);
    expect(TotpSetupConfirmRequest.parse({ challenge, code: '123456' })).toEqual({
      challenge,
      code: '123456',
      rememberDevice: false,
    });
    expect(TotpSetupConfirmRequest.safeParse({ challenge }).success).toBe(false);
  });

  it('TotpSetup — base32 и otpauth', () => {
    const setup = { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' };
    expect(TotpSetup.parse(setup)).toEqual(setup);
    expect(TotpSetup.safeParse({ ...setup, secret: 'jbswy3dp' }).success).toBe(false);
    expect(TotpSetup.safeParse({ ...setup, otpauthUri: 'https://x' }).success).toBe(false);
  });

  it('код настроек — strict; отключение — ровно одно из code/recoveryCode', () => {
    expect(TotpCodeRequest.parse({ code: '123456' })).toEqual({ code: '123456' });
    expect(TotpCodeRequest.safeParse({ code: '123456', extra: 1 }).success).toBe(false);
    expect(TotpDisableRequest.parse({ code: '123456' })).toEqual({ code: '123456' });
    expect(TotpDisableRequest.parse({ recoveryCode: 'abcdefgh27' })).toEqual({
      recoveryCode: 'abcdefgh27',
    });
    expect(TotpDisableRequest.safeParse({}).success).toBe(false);
    expect(
      TotpDisableRequest.safeParse({ code: '123456', recoveryCode: 'abcdefgh27' }).success,
    ).toBe(false);
  });

  it('сброс — причина обязательна', () => {
    expect(TotpResetRequest.safeParse({}).success).toBe(false);
    expect(TotpResetRequest.parse({ reason: 'потерян телефон' })).toEqual({
      reason: 'потерян телефон',
    });
  });

  it('статус', () => {
    const status = { enabled: true, enabledAt: '2026-10-29T10:00:00.000Z', required: true, recoveryCodesLeft: 9 };
    expect(TotpStatus.parse(status)).toEqual(status);
    expect(TotpStatus.safeParse({ ...status, recoveryCodesLeft: -1 }).success).toBe(false);
  });
});
