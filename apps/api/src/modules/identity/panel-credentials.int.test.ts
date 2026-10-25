import { RegisterResponse } from '@pokatim/contracts';
import { isDomainError } from '@rkarakulov/api-kit/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import {
  activeLinkToken,
  call,
  collections,
  confirm,
  confirmPasswordReset,
  latestResetToken,
  register,
  requestPasswordReset,
  resend,
  userIdByEmail,
  validRegistration,
} from '../../../test/identity';
import { IdentityAccounts } from './identity-accounts';
import { IDENTITY_POLICY } from './identity.policy';
import { PanelCredentials } from './panel-credentials';
import { PasswordHasher } from './password-hasher';
import { sha256 } from './tokens';

/**
 * Порт входа в панель (ADR-0009, S2): та же проверка, что вход приложения, — общие счётчики, пустышка, один 401;
 * неподтверждённому — токен регистрации; подтверждённому — штамп учётных данных без сессии приложения.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ TRUST_PROXY: '1' });
});
beforeEach(async () => {
  await h.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const { email: EMAIL, password: PASSWORD } = validRegistration();
const IP = '198.51.100.7';
const port = () => h.app.get(PanelCredentials, { strict: false });
const accounts = () => h.app.get(IdentityAccounts, { strict: false });
const verify = (password = PASSWORD, email = EMAIL, ip = IP) =>
  port().verify({ email, password }, ip);

/** Отказ порта — DomainError: код и статус. */
async function rejection(operation: Promise<unknown>) {
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isDomainError(error)) throw new Error(`ожидался DomainError, получено ${String(error)}`);
  return { code: error.code, status: error.status, details: error.details };
}

async function verifiedAccount() {
  await register(h);
  await confirm(h, await activeLinkToken(h));
}

describe('PanelCredentials.verify', () => {
  it('подтверждённый с верным паролем — id, e-mail и штамп; сессия приложения не выдаётся', async () => {
    await verifiedAccount();
    const userId = await userIdByEmail(h);

    const result = await verify(PASSWORD, '  Rider@Example.COM ');

    expect(result).toEqual({
      state: 'verified',
      userId,
      email: EMAIL,
      credentialsStamp: (await accounts().accountState(userId))?.credentialsStamp,
    });
    expect(await collections(h).sessions.countDocuments()).toBe(0);
  });

  it('неверный пароль, неизвестный и удалённый адрес — один 401 INVALID_CREDENTIALS; для неизвестного — пустышка', async () => {
    await verifiedAccount();
    const verifySpy = vi.spyOn(h.app.get(PasswordHasher, { strict: false }), 'verify');

    const wrong = await rejection(verify('wrong-password'));
    const unknown = await rejection(verify(PASSWORD, 'nobody@example.com'));
    await collections(h).users.updateMany({}, { $set: { deletedAt: h.clock.now() } });
    const deleted = await rejection(verify(PASSWORD));

    for (const result of [wrong, unknown, deleted]) {
      expect(result).toEqual({ code: 'INVALID_CREDENTIALS', status: 401, details: undefined });
    }
    expect(verifySpy).toHaveBeenCalledTimes(3);
  });

  it('неподтверждённый с верным паролем — новый токен регистрации; resend с ним работает, прежний — нет', async () => {
    const first = RegisterResponse.parse((await register(h)).body);

    const result = await verify();
    if (result.state !== 'verificationRequired') throw new Error('expected verificationRequired');

    expect(result).toMatchObject({ email: EMAIL, resendAvailableInSec: 0 });
    expect(result.registrationToken).not.toBe(first.registrationToken);
    expect(
      await collections(h).registrationTokens.countDocuments({
        tokenHash: sha256(result.registrationToken),
      }),
    ).toBe(1);
    h.clock.advance(IDENTITY_POLICY.resendLimit.cooldownSec * 1000);
    expect((await resend(h, { registrationToken: result.registrationToken })).status).toBe(200);
    expect((await resend(h, { registrationToken: first.registrationToken })).status).toBe(401);
  });

  it('счётчики общие со входом приложения: 3 попытки приложения + 2 панели — 6-я (панель) 429 до проверки пароля', async () => {
    await verifiedAccount();
    const { limit } = IDENTITY_POLICY.signInLimits.emailIp;
    expect(limit).toBe(5);
    for (let i = 0; i < 3; i += 1) {
      const res = await call(
        h,
        'POST',
        '/v1/auth/session/sign-in',
        { email: EMAIL, password: 'wrong-password' },
        { 'x-forwarded-for': IP },
      );
      expect(res.status).toBe(401);
    }
    for (let i = 0; i < 2; i += 1) {
      expect((await rejection(verify('wrong-password'))).status).toBe(401);
    }
    const verifySpy = vi.spyOn(h.app.get(PasswordHasher, { strict: false }), 'verify');

    const limited = await rejection(verify());

    expect(limited).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(verifySpy).not.toHaveBeenCalled();
    // и обратно: вход приложения с той же пары тоже заблокирован
    const app = await call(
      h,
      'POST',
      '/v1/auth/session/sign-in',
      { email: EMAIL, password: PASSWORD },
      { 'x-forwarded-for': IP },
    );
    expect(app.status).toBe(429);
  });
});

describe('IdentityAccounts', () => {
  it('accountState: активный подтверждённый; штамп меняется после сброса пароля', async () => {
    await verifiedAccount();
    const userId = await userIdByEmail(h);
    const before = await accounts().accountState(userId);
    expect(before).toMatchObject({ active: true });

    await requestPasswordReset(h, EMAIL);
    expect(
      (await confirmPasswordReset(h, await latestResetToken(h), 'brand-new-password')).status,
    ).toBe(200);

    const after = await accounts().accountState(userId);
    expect(after?.active).toBe(true);
    expect(after?.credentialsStamp).not.toBe(before?.credentialsStamp);
    // штамп входа новым паролем совпадает с текущим
    const signedIn = await verify('brand-new-password');
    expect(signedIn).toMatchObject({ credentialsStamp: after?.credentialsStamp });
  });

  it('accountState: неподтверждённый и удалённый — не active; неизвестный id — undefined', async () => {
    await register(h);
    const userId = await userIdByEmail(h);
    expect(await accounts().accountState(userId)).toMatchObject({ active: false });

    await confirm(h, await activeLinkToken(h));
    await collections(h).users.updateOne({ _id: userId }, { $set: { deletedAt: h.clock.now() } });
    expect(await accounts().accountState(userId)).toMatchObject({ active: false });
    expect(await accounts().accountState('01890a5d-ac96-774b-bcce-b302099a8057')).toBeUndefined();
  });

  it('findVerifiedByEmail: нормализация адреса; неподтверждённый — verified=false; удалённый и неизвестный — undefined', async () => {
    await register(h);
    const userId = await userIdByEmail(h);
    expect(await accounts().findVerifiedByEmail(' RIDER@example.com')).toEqual({
      userId,
      verified: false,
    });
    await confirm(h, await activeLinkToken(h));
    expect(await accounts().findVerifiedByEmail(EMAIL)).toEqual({ userId, verified: true });
    expect(await accounts().findVerifiedByEmail('nobody@example.com')).toBeUndefined();
    await collections(h).users.updateOne({ _id: userId }, { $set: { deletedAt: h.clock.now() } });
    expect(await accounts().findVerifiedByEmail(EMAIL)).toBeUndefined();
  });

  it('emailsOf: один запрос по id, удалённых нет; пустой список — пустая карта', async () => {
    await verifiedAccount();
    await register(h, { email: 'second@example.com' });
    const first = await userIdByEmail(h);
    const second = await userIdByEmail(h, 'second@example.com');
    await collections(h).users.updateOne({ _id: second }, { $set: { deletedAt: h.clock.now() } });

    const emails = await accounts().emailsOf([
      first,
      second,
      '01890a5d-ac96-774b-bcce-b302099a8057',
    ]);

    expect([...emails]).toEqual([[first, EMAIL]]);
    expect((await accounts().emailsOf([])).size).toBe(0);
  });
});
