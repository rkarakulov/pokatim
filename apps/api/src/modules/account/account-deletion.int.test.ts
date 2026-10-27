import { SESSION_COOKIE, SignInResponse } from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, type Harness } from '../../../test/harness';
import {
  bearer,
  call,
  collections,
  confirmPasswordReset,
  gate,
  identityRepository,
  latestResetToken,
  outboxEvents,
  requestPasswordReset,
  signUpSession,
  userIdByEmail,
  validRegistration,
} from '../../../test/identity';
import { panel, seedMember } from '../../../test/panel';
import { ACCOUNT_DELETION_REQUESTED } from './account.events';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
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

const DELETE = '/v1/account/delete';
const { email: EMAIL, password: PASSWORD } = validRegistration();

const deleteAccount = (
  accessToken: string | undefined,
  password = PASSWORD,
  headers: Record<string, string> = {},
) =>
  call(
    h,
    'POST',
    DELETE,
    { password },
    {
      ...(accessToken ? bearer(accessToken) : {}),
      ...headers,
    },
  );

const signIn = (password = PASSWORD) =>
  call(h, 'POST', '/v1/auth/session/sign-in', { email: EMAIL, password });
const profile = (accessToken: string) =>
  call(h, 'GET', '/v1/profile', undefined, bearer(accessToken));
const deletionEvents = async () =>
  (await outboxEvents(h)).filter((event) => event.type === ACCOUNT_DELETION_REQUESTED);
const userDoc = async () => collections(h).users.findOne({ email: EMAIL });
const repository = () => identityRepository(h);

describe('POST /v1/account/delete — успех (AC1, AC7)', () => {
  it('204: сессии отозваны (access и refresh — 401), cookie сброшена, одно событие очистки, no-store', async () => {
    const session = await signUpSession(h);
    const other = SignInResponse.parse((await signIn()).body);
    const userId = await userIdByEmail(h);

    const res = await deleteAccount(session.accessToken);

    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
    const cookie = String(res.headers['set-cookie'] ?? '');
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE.name}=;`));
    expect(cookie).toContain(`Path=${SESSION_COOKIE.path}`);
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    expect((await profile(session.accessToken)).status).toBe(401);
    const refreshed = await call(h, 'POST', '/v1/auth/session/refresh', {
      refreshToken: session.refreshToken,
    });
    expect(refreshed.status).toBe(401);
    if (other.state === 'signedIn' && 'refreshToken' in other.session) {
      expect((await profile(other.session.accessToken)).status).toBe(401);
    }
    const sessions = await collections(h).sessions.find({ userId }).toArray();
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.revokedReason === 'account_deleted')).toBe(true);
    expect((await userDoc())?.deletedAt).toEqual(h.clock.now());

    const events = await deletionEvents();
    expect(events.map((event) => event.payload)).toEqual([{ userId }]);
  });

  it('журнал панели: account.deleted от самого райдера, субъект rider без e-mail и имени (AC7)', async () => {
    const session = await signUpSession(h);
    const userId = await userIdByEmail(h);
    await deleteAccount(session.accessToken);

    const records = await panel(h).audit.find({ action: 'account.deleted' }).toArray();
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({
      actor: { kind: 'user', userId },
      targetUserId: null,
      reason: null,
      details: null,
      subject: { kind: 'rider', id: userId, label: `Участник ·${userId.slice(-6)}` },
    });
    expect(JSON.stringify(record)).not.toContain('@');
  });

  it('повтор после удаления — 401, второго события нет (N6)', async () => {
    const session = await signUpSession(h);
    expect((await deleteAccount(session.accessToken)).status).toBe(204);

    expect((await deleteAccount(session.accessToken)).status).toBe(401);
    expect(await deletionEvents()).toHaveLength(1);
  });

  it('два параллельных запроса — одно закрытие: одно событие и одна запись журнала (N6)', async () => {
    const session = await signUpSession(h);
    const results = await Promise.all([
      deleteAccount(session.accessToken),
      deleteAccount(session.accessToken),
    ]);

    expect(results.map((r) => r.status)).toContain(204);
    for (const r of results) expect([204, 401]).toContain(r.status);
    expect(await deletionEvents()).toHaveLength(1);
    expect(await panel(h).audit.countDocuments({ action: 'account.deleted' })).toBe(1);
  });
});

describe('POST /v1/account/delete — отказы', () => {
  it('неверный пароль — 403 PASSWORD_INCORRECT: сессия жива, ничего не тронуто, счётчики входа растут (N1)', async () => {
    const session = await signUpSession(h);
    const before = await userDoc();

    for (let i = 0; i < 5; i += 1) {
      const res = await deleteAccount(session.accessToken, 'wrong-password');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'PASSWORD_INCORRECT' });
    }

    expect((await profile(session.accessToken)).status).toBe(200);
    expect(await userDoc()).toEqual(before);
    expect(await deletionEvents()).toHaveLength(0);
    // пара e-mail+IP входа исчерпана попытками удаления (общие счётчики A2)
    const blocked = await signIn();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('член команды панели — 409 ACCOUNT_PANEL_MEMBER до пароля: ничего не тронуто, счётчики входа целы (N2)', async () => {
    const session = await signUpSession(h);
    const userId = await userIdByEmail(h);
    await seedMember(h, userId, 'organizer');
    const before = await userDoc();

    for (let i = 0; i < 5; i += 1) {
      const res = await deleteAccount(session.accessToken, 'wrong-password');
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_PANEL_MEMBER' });
    }

    expect(await userDoc()).toEqual(before);
    expect((await profile(session.accessToken)).status).toBe(200);
    expect(await deletionEvents()).toHaveLength(0);
    // пароль не проверялся: все пять попыток входа пары e-mail+IP доступны
    for (let i = 0; i < 5; i += 1) expect((await signIn()).status).toBe(200);
  });

  it('снятая роль панели не мешает удалению', async () => {
    const session = await signUpSession(h);
    await seedMember(h, await userIdByEmail(h), 'moderator', { status: 'revoked' });
    expect((await deleteAccount(session.accessToken)).status).toBe(204);
  });

  it('6-я попытка за час — 429 до проверки пароля и роли, данные не тронуты (N3)', async () => {
    const session = await signUpSession(h);
    const userId = await userIdByEmail(h);
    await seedMember(h, userId, 'organizer');
    for (let i = 0; i < 5; i += 1)
      expect((await deleteAccount(session.accessToken)).status).toBe(409);
    await panel(h).members.deleteOne({ _id: userId });

    const res = await deleteAccount(session.accessToken);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
    expect((await userDoc())?.deletedAt).toBeNull();
    expect(await deletionEvents()).toHaveLength(0);
  });

  it('без входа — 401; межсайтовый POST — 403 до обработчика (N7)', async () => {
    const session = await signUpSession(h);
    expect((await deleteAccount(undefined)).status).toBe(401);
    const cross = await deleteAccount(session.accessToken, PASSWORD, {
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
    });
    expect(cross.status).toBe(403);
    expect((await userDoc())?.deletedAt).toBeNull();
  });

  it('лишние ключи и пустой пароль — 400', async () => {
    const session = await signUpSession(h);
    const extra = await call(
      h,
      'POST',
      DELETE,
      { password: PASSWORD, email: EMAIL },
      bearer(session.accessToken),
    );
    expect(extra.status).toBe(400);
    expect((await deleteAccount(session.accessToken, '')).status).toBe(400);
  });

  it('логи удаления — без e-mail и пароля', async () => {
    const session = await signUpSession(h);
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    });
    await deleteAccount(session.accessToken);
    write.mockRestore();
    for (const line of logs) {
      expect(line).not.toContain(EMAIL);
      expect(line).not.toContain(PASSWORD);
    }
  });
});

describe('гонка со сбросом пароля (ворота на lockUserCredentials)', () => {
  const NEW_PASSWORD = 'brand-new-password';

  it('сброс закоммичен между проверкой пароля и транзакцией — 401, аккаунт не удалён, события нет', async () => {
    const session = await signUpSession(h);
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    const target = repository();
    const lock = target.lockUserCredentials.bind(target);
    const paused = gate();
    vi.spyOn(target, 'lockUserCredentials').mockImplementationOnce(async (tx, userId) => {
      await paused.wait();
      return lock(tx, userId);
    });

    const deleting = deleteAccount(session.accessToken);
    await paused.reached; // старый пароль уже проверен argon2
    expect((await confirmPasswordReset(h, token, NEW_PASSWORD)).status).toBe(200);
    paused.open();

    const res = await deleting;
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await userDoc())?.deletedAt).toBeNull();
    expect(await deletionEvents()).toHaveLength(0);
  });

  it('отрицательное доказательство: замок подменён чтением на момент проверки — удаление проходит со сменённым паролем', async () => {
    const session = await signUpSession(h);
    await requestPasswordReset(h, EMAIL);
    const token = await latestResetToken(h);
    const target = repository();
    const paused = gate();
    vi.spyOn(target, 'lockUserCredentials').mockImplementationOnce(async (_tx, userId) => {
      // без механизма: состояние прочитано до сброса, без записи в документ и без сверки свежего хеша
      const stale = await target.findCredentialsById(userId);
      await paused.wait();
      return stale;
    });

    const deleting = deleteAccount(session.accessToken);
    await paused.reached;
    expect((await confirmPasswordReset(h, token, NEW_PASSWORD)).status).toBe(200);
    paused.open();

    expect((await deleting).status).toBe(204);
    expect((await userDoc())?.deletedAt).not.toBeNull();
  });
});
