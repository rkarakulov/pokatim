import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ageInYears,
  minskToday,
  normalizeEmail,
  RegisterRequest,
  RegisterResponse,
  RegistrationPollRequest,
  RegistrationPollResponse,
} from './registration.schema.ts';

const fieldCodes = (input: unknown) => {
  const result = RegisterRequest.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

describe('ageInYears', () => {
  it('не считает год до дня рождения', () => {
    expect(ageInYears('2008-10-23', '2026-10-22')).toBe(17);
    expect(ageInYears('2008-10-22', '2026-10-22')).toBe(18);
  });

  it('29 февраля: в невисокосный год день рождения наступает 1 марта', () => {
    expect(ageInYears('2008-02-29', '2026-02-28')).toBe(17);
    expect(ageInYears('2008-02-29', '2026-03-01')).toBe(18);
  });
});

describe('minskToday', () => {
  it('берёт календарную дату в Europe/Minsk (UTC+3), а не в UTC', () => {
    expect(minskToday(new Date('2026-10-21T20:59:59Z'))).toBe('2026-10-21');
    expect(minskToday(new Date('2026-10-21T21:00:00Z'))).toBe('2026-10-22');
  });
});

describe('normalizeEmail', () => {
  it('обрезает пробелы и приводит к нижнему регистру', () => {
    expect(normalizeEmail('  Rider@Example.COM ')).toBe('rider@example.com');
  });
});

describe('RegisterRequest', () => {
  const valid = {
    email: 'rider@example.com',
    password: 'long-enough',
    birthDate: '1990-05-01',
    personalDataConsent: true,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // в Минске уже 22 октября, в UTC — ещё 21-е
    vi.setSystemTime(new Date('2026-10-21T22:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('принимает валидную регистрацию', () => {
    expect(RegisterRequest.safeParse(valid).success).toBe(true);
  });

  it('invite (P6): необязателен, валидный — в верхнем регистре, мусор — undefined, а не ошибка', () => {
    expect(RegisterRequest.parse(valid).invite).toBeUndefined();
    expect(RegisterRequest.parse({ ...valid, invite: 'k7m2pqx' }).invite).toBe('K7M2PQX');
    for (const junk of ['K7M2PQ0', 'x', 42, null, { code: 'K7M2PQX' }]) {
      const parsed = RegisterRequest.safeParse({ ...valid, invite: junk });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.invite).toBeUndefined();
    }
  });

  it('срезает пробелы вокруг e-mail', () => {
    expect(RegisterRequest.parse({ ...valid, email: ' Rider@Example.com ' }).email).toBe(
      'Rider@Example.com',
    );
  });

  it('18 лет исполняется сегодня по Минску — можно', () => {
    expect(RegisterRequest.safeParse({ ...valid, birthDate: '2008-10-22' }).success).toBe(true);
    expect(fieldCodes({ ...valid, birthDate: '2008-10-23' })).toEqual([
      ['birthDate', 'AGE_BELOW_18'],
    ]);
  });

  it('коды полей: без согласия, короткий и длинный пароль, плохой e-mail', () => {
    expect(fieldCodes({ ...valid, personalDataConsent: false })).toEqual([
      ['personalDataConsent', 'CONSENT_REQUIRED'],
    ]);
    expect(fieldCodes({ ...valid, password: 'short' })).toEqual([['password', 'TOO_SHORT']]);
    expect(fieldCodes({ ...valid, password: 'x'.repeat(129) })).toEqual([['password', 'TOO_LONG']]);
    expect(fieldCodes({ ...valid, email: 'not-an-email' })).toEqual([['email', 'INVALID_EMAIL']]);
    expect(fieldCodes({ ...valid, email: `${'a'.repeat(250)}@b.by` })).toEqual([
      ['email', 'TOO_LONG'],
    ]);
  });

  it('пустой запрос — REQUIRED по каждому полю, согласие — CONSENT_REQUIRED', () => {
    expect(fieldCodes({})).toEqual([
      ['email', 'REQUIRED'],
      ['password', 'REQUIRED'],
      ['birthDate', 'REQUIRED'],
      ['personalDataConsent', 'CONSENT_REQUIRED'],
    ]);
  });

  it('дата рождения: не дата, раньше 1900, в будущем — INVALID_DATE', () => {
    expect(fieldCodes({ ...valid, birthDate: '01.05.1990' })).toEqual([
      ['birthDate', 'INVALID_DATE'],
    ]);
    expect(fieldCodes({ ...valid, birthDate: '1899-12-31' })).toEqual([
      ['birthDate', 'INVALID_DATE'],
    ]);
    expect(fieldCodes({ ...valid, birthDate: '2026-10-23' })).toEqual([
      ['birthDate', 'INVALID_DATE'],
    ]);
  });
});

describe('ответы регистрации', () => {
  const token = 'a'.repeat(43);

  it('RegisterResponse', () => {
    expect(
      RegisterResponse.safeParse({
        registrationToken: token,
        email: 'rider@example.com',
        resendAvailableInSec: 60,
      }).success,
    ).toBe(true);
  });

  it('RegistrationPollResponse: pending или verified с сессией', () => {
    expect(RegistrationPollResponse.parse({ state: 'pending' })).toEqual({ state: 'pending' });
    const session = {
      accessToken: 'jwt',
      accessTokenExpiresAt: '2026-10-22T10:15:00.000Z',
      refreshToken: token,
      refreshTokenExpiresAt: '2026-11-21T10:00:00.000Z',
    };
    expect(RegistrationPollResponse.parse({ state: 'verified', session })).toEqual({
      state: 'verified',
      session,
    });
    expect(RegistrationPollResponse.safeParse({ state: 'verified' }).success).toBe(false);
  });

  it('RegistrationPollResponse: web (cookie) — сессия без refreshToken', () => {
    const cookieSession = {
      accessToken: 'jwt',
      accessTokenExpiresAt: '2026-10-22T10:15:00.000Z',
      refreshTokenExpiresAt: '2026-11-21T10:00:00.000Z',
    };
    expect(RegistrationPollResponse.parse({ state: 'verified', session: cookieSession })).toEqual({
      state: 'verified',
      session: cookieSession,
    });
  });
});

describe('RegistrationPollRequest', () => {
  const token = 'a'.repeat(43);

  it('старый запрос native без sessionTransport валиден', () => {
    expect(RegistrationPollRequest.parse({ registrationToken: token })).toEqual({
      registrationToken: token,
    });
  });

  it('sessionTransport — body или cookie', () => {
    expect(
      RegistrationPollRequest.parse({ registrationToken: token, sessionTransport: 'cookie' }),
    ).toEqual({ registrationToken: token, sessionTransport: 'cookie' });
    expect(
      RegistrationPollRequest.safeParse({ registrationToken: token, sessionTransport: 'header' })
        .success,
    ).toBe(false);
  });
});
