import {
  PANEL_SESSION_COOKIE,
  PanelSignInResponse,
  RegisterResponse,
  Session,
  SESSION_COOKIE,
  SignInResponse,
} from '@pokatim/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, HOUR, MINUTE, type Harness } from '../../../test/harness';
import {
  bearer,
  call,
  gate,
  collections,
  confirmPasswordReset,
  latestResetToken,
  register,
  requestPasswordReset,
  resend,
  userIdByEmail,
} from '../../../test/identity';
import {
  memberUser,
  panel,
  PANEL_PASSWORD,
  panelCall,
  panelCookieValue,
  panelSession,
  panelSetCookie,
  panelSignIn,
  seedMember,
  verifiedUser,
} from '../../../test/panel';
import { IdentityAccounts, sha256 } from '../identity';
import { PanelRepository } from './panel.repository';

/** Сессия панели (S4): вход, изоляция от сессии приложения, гард, выход, гонка «вход ↔ сброс пароля». */
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

const ADMIN = 'olga@example.by';
const ME = '/v1/admin/session/me';
const SIGN_OUT = '/v1/admin/session/sign-out';
const UNAUTHORIZED = { code: 'UNAUTHORIZED' };

const me = (token: string | undefined, headers: Record<string, string> = {}) =>
  panelCall(h, token, 'GET', ME, undefined, headers);

/** Сырой ответ (тело — текст): для побайтного сравнения тел. */
async function raw(url: string, payload: unknown, ip = '198.51.100.30') {
  const response = await h.app.inject({
    method: 'POST',
    url,
    payload: payload as Record<string, unknown>,
    headers: { 'x-forwarded-for': ip },
  });
  return { status: response.statusCode, body: response.body };
}

/** Cookie панели сброшена: тот же путь, `Max-Age=0` или дата в прошлом. */
function expectCleared(res: Awaited<ReturnType<typeof me>>) {
  const cookie = panelSetCookie(res);
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/^__Secure-pokatim_admin_sid=;/);
  expect(cookie).toContain(`Path=${PANEL_SESSION_COOKIE.path}`);
  expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
}

describe('POST /v1/admin/session/sign-in (AC2)', () => {
  it('активный член команды — 200 signedIn + PanelMe, cookie §8.3, сессия хешем, журнал signed_in; сессии приложения нет', async () => {
    const userId = await memberUser(h, ADMIN, 'admin');

    const res = await panelSignIn(h, ' Olga@Example.BY ');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(PanelSignInResponse.parse(res.body)).toEqual({
      state: 'signedIn',
      me: {
        user: { id: userId, displayName: 'Сотрудник admin', email: ADMIN, role: 'admin' },
        permissions: ['members.read', 'members.manage', 'audit.read'],
      },
    });
    const cookie = panelSetCookie(res) ?? '';
    const token = panelCookieValue(res) ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/v1/admin');
    expect(cookie).toContain(`Max-Age=${12 * 3600}`);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(JSON.stringify(res.body)).not.toContain(token);

    const sessions = await panel(h).sessions.find().toArray();
    expect(sessions).toEqual([
      expect.objectContaining({
        userId,
        tokenHash: sha256(token),
        revokedAt: null,
        idleExpiresAt: new Date(h.clock.now().getTime() + 2 * HOUR),
        expiresAt: new Date(h.clock.now().getTime() + 12 * HOUR),
      }),
    ]);
    expect(await collections(h).sessions.countDocuments()).toBe(0);
    expect(await panel(h).audit.find().toArray()).toEqual([
      expect.objectContaining({
        action: 'panel.signed_in',
        actor: { kind: 'user', userId },
        at: h.clock.now(),
        targetUserId: null,
      }),
    ]);
  });

  it('неверный пароль, неизвестный и удалённый адрес — 401 INVALID_CREDENTIALS, тело побайтно равно ответу приложения', async () => {
    await memberUser(h, ADMIN, 'admin');
    const app = await raw('/v1/auth/session/sign-in', { email: ADMIN, password: 'wrong-password' });
    const wrong = await raw('/v1/admin/session/sign-in', {
      email: ADMIN,
      password: 'wrong-password',
    });
    const unknown = await raw('/v1/admin/session/sign-in', {
      email: 'nobody@example.by',
      password: PANEL_PASSWORD,
    });
    await collections(h).users.updateMany({}, { $set: { deletedAt: h.clock.now() } });
    const deleted = await raw('/v1/admin/session/sign-in', {
      email: ADMIN,
      password: PANEL_PASSWORD,
    });

    expect(app.status).toBe(401);
    for (const res of [wrong, unknown, deleted]) {
      expect(res).toEqual(app);
    }
    expect(await panel(h).sessions.countDocuments()).toBe(0);
    expect(await panel(h).audit.countDocuments()).toBe(0);
  });

  it('верный пароль без роли и со снятой ролью — 403 PANEL_ACCESS_DENIED; сессии, cookie и записи журнала нет', async () => {
    await verifiedUser(h, 'rider@example.by');
    const revoked = await verifiedUser(h, ADMIN);
    await seedMember(h, revoked, 'moderator', { status: 'revoked' });

    for (const email of ['rider@example.by', ADMIN]) {
      const res = await panelSignIn(h, email);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'PANEL_ACCESS_DENIED' });
      expect(panelSetCookie(res)).toBeUndefined();
    }
    expect(await panel(h).sessions.countDocuments()).toBe(0);
    expect(await panel(h).audit.countDocuments()).toBe(0);
  });

  it('неподтверждённый с верным паролем — verificationRequired; resend с этим токеном работает', async () => {
    const first = RegisterResponse.parse((await register(h, { email: ADMIN })).body);
    await seedMember(h, await userIdByEmail(h, ADMIN), 'admin');

    const res = await panelSignIn(h, ADMIN);

    expect(res.status).toBe(200);
    const body = PanelSignInResponse.parse(res.body);
    if (body.state !== 'verificationRequired') throw new Error('expected verificationRequired');
    expect(body.registrationToken).not.toBe(first.registrationToken);
    expect(panelSetCookie(res)).toBeUndefined();
    h.clock.advance(MINUTE);
    expect((await resend(h, { registrationToken: body.registrationToken })).status).toBe(200);
  });

  it('счётчики общие с приложением: 3 попытки приложения + 2 панели — 6-я 429 и с верным паролем', async () => {
    await memberUser(h, ADMIN, 'admin');
    const ip = '203.0.113.9';
    for (let i = 0; i < 3; i += 1) {
      const res = await call(
        h,
        'POST',
        '/v1/auth/session/sign-in',
        { email: ADMIN, password: 'wrong-password' },
        { 'x-forwarded-for': ip },
      );
      expect(res.status).toBe(401);
    }
    for (let i = 0; i < 2; i += 1) {
      expect((await panelSignIn(h, ADMIN, 'wrong-password', {}, ip)).status).toBe(401);
    }

    const sixth = await panelSignIn(h, ADMIN, PANEL_PASSWORD, {}, ip);

    expect(sixth.status).toBe(429);
    expect(sixth.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('прежняя cookie панели этого браузера при входе отзывается (superseded)', async () => {
    await memberUser(h, ADMIN, 'admin');
    const previous = await panelSession(h, ADMIN);

    const res = await panelSignIn(h, ADMIN, PANEL_PASSWORD, {
      cookie: `${PANEL_SESSION_COOKIE.name}=${previous}`,
    });

    expect(res.status).toBe(200);
    expect(await panel(h).sessions.findOne({ tokenHash: sha256(previous) })).toMatchObject({
      revokedReason: 'superseded',
    });
    expect((await me(previous)).status).toBe(401);
    expect((await me(panelCookieValue(res))).status).toBe(200);
  });

  it('инъекция и лишние ключи в теле — 400 до проверки пароля', async () => {
    await memberUser(h, ADMIN, 'admin');
    for (const body of [
      { email: { $ne: null }, password: PANEL_PASSWORD },
      { email: ADMIN, password: { $gt: '' } },
      { email: ADMIN, password: PANEL_PASSWORD, sessionTransport: 'cookie' },
    ]) {
      const res = await call(h, 'POST', '/v1/admin/session/sign-in', body);
      expect(res.status).toBe(400);
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(await panel(h).sessions.countDocuments()).toBe(0);
  });
});

describe('изоляция от сессии приложения (AC3)', () => {
  it('живой access JWT приложения и refresh-cookie приложения без cookie панели — 401', async () => {
    await memberUser(h, ADMIN, 'admin');
    const signedIn = SignInResponse.parse(
      (
        await call(
          h,
          'POST',
          '/v1/auth/session/sign-in',
          { email: ADMIN, password: PANEL_PASSWORD },
          { 'x-forwarded-for': '198.51.100.40' },
        )
      ).body,
    );
    if (signedIn.state !== 'signedIn') throw new Error('expected signedIn');
    const session = Session.parse(signedIn.session);
    // access приложения рабочий
    expect(
      (await call(h, 'GET', '/v1/profile/onboarding', undefined, bearer(session.accessToken)))
        .status,
    ).toBe(200);

    const res = await me(undefined, {
      ...bearer(session.accessToken),
      cookie: `${SESSION_COOKIE.name}=${session.refreshToken}`,
    });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject(UNAUTHORIZED);
  });

  it('cookie панели — с путём /v1/admin: на /v1/auth/session/* браузер её не отправит', async () => {
    await memberUser(h, ADMIN, 'admin');
    const cookie = panelSetCookie(await panelSignIn(h, ADMIN)) ?? '';
    const path = /Path=([^;]+)/.exec(cookie)?.[1] ?? '';
    expect(path).toBe('/v1/admin');
    expect(SESSION_COOKIE.path.startsWith(path)).toBe(false);
  });

  it('Sec-Fetch-Site: cross-site на POST /v1/admin/* — 403 до обработчика', async () => {
    await memberUser(h, ADMIN, 'admin');
    const token = await panelSession(h, ADMIN);
    const cross = { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' };

    const signIn = await panelSignIn(h, ADMIN, PANEL_PASSWORD, cross);
    const signOut = await panelCall(h, token, 'POST', SIGN_OUT, {}, cross);

    expect(signIn.status).toBe(403);
    expect(signOut.status).toBe(403);
    expect((await me(token)).status).toBe(200);
    expect(await panel(h).sessions.countDocuments({ revokedAt: null })).toBe(1);
  });
});

describe('PanelGuard: сессия (AC4)', () => {
  it('живая cookie — 200 и no-store; мусор, оператор и отсутствие — 401 одним телом, предъявленная cookie сброшена', async () => {
    await memberUser(h, ADMIN, 'admin');
    const token = await panelSession(h, ADMIN);

    const alive = await me(token);
    expect(alive.status).toBe(200);
    expect(alive.headers['cache-control']).toBe('no-store');

    const bodies = [];
    for (const value of ['garbage', '{"$gt":""}', 'A'.repeat(43)]) {
      const res = await call(h, 'GET', ME, undefined, {
        cookie: `${PANEL_SESSION_COOKIE.name}=${encodeURIComponent(value)}`,
      });
      expect(res.status).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
      expectCleared(res);
      bodies.push(res.body);
    }
    const none = await me(undefined);
    expect(none.status).toBe(401);
    expect(panelSetCookie(none)).toBeUndefined();
    bodies.push(none.body);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('простой 2 ч без запросов — 401; запросы продлевают простой, но не дальше абсолютных 12 ч', async () => {
    await memberUser(h, ADMIN, 'admin');
    const idle = await panelSession(h, ADMIN);
    h.clock.advance(2 * HOUR);
    const idleRes = await me(idle);
    expect(idleRes.status).toBe(401);
    expectCleared(idleRes);

    const active = await panelSession(h, ADMIN);
    for (let elapsed = 0; elapsed < 12 * HOUR - 90 * MINUTE; elapsed += 90 * MINUTE) {
      h.clock.advance(90 * MINUTE);
      expect((await me(active)).status).toBe(200);
    }
    h.clock.advance(90 * MINUTE);
    expect((await me(active)).status).toBe(401);
  });

  it('продление простоя пишется не чаще раза в 5 мин', async () => {
    await memberUser(h, ADMIN, 'admin');
    const token = await panelSession(h, ADMIN);
    const before = await panel(h).sessions.findOne({});

    h.clock.advance(4 * MINUTE);
    await me(token);
    expect(await panel(h).sessions.findOne({})).toEqual(before);

    h.clock.advance(2 * MINUTE);
    await me(token);
    expect(await panel(h).sessions.findOne({})).toMatchObject({
      lastSeenAt: h.clock.now(),
      idleExpiresAt: new Date(h.clock.now().getTime() + 2 * HOUR),
    });
  });

  it('снятие роли, сброс пароля приложения, удаление аккаунта, неподтверждённый — 401, сессия отозвана с причиной', async () => {
    const cases = [
      {
        email: 'role@example.by',
        act: (userId: string) =>
          panel(h).members.updateOne({ _id: userId }, { $set: { status: 'revoked' } }),
        reason: 'role_revoked',
      },
      {
        email: 'reset@example.by',
        act: async () => {
          await requestPasswordReset(h, 'reset@example.by');
          const token = await latestResetToken(h, 'reset@example.by');
          expect((await confirmPasswordReset(h, token, 'brand-new-password')).status).toBe(200);
        },
        reason: 'credentials_changed',
      },
      {
        email: 'deleted@example.by',
        act: (userId: string) =>
          collections(h).users.updateOne({ _id: userId }, { $set: { deletedAt: h.clock.now() } }),
        reason: 'account_inactive',
      },
    ] as const;
    for (const { email, act, reason } of cases) {
      const userId = await memberUser(h, email, 'moderator');
      const token = await panelSession(h, email);
      expect((await me(token)).status).toBe(200);

      await act(userId);
      const res = await me(token);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject(UNAUTHORIZED);
      expectCleared(res);
      expect(await panel(h).sessions.findOne({ userId })).toMatchObject({ revokedReason: reason });
    }
  });

  it('выход — 204, cookie сброшена, сессия отозвана, журнал signed_out; повтор и без cookie — тоже 204 без записи', async () => {
    const userId = await memberUser(h, ADMIN, 'admin');
    const token = await panelSession(h, ADMIN);

    const res = await panelCall(h, token, 'POST', SIGN_OUT, {});

    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    expectCleared(res);
    expect(await panel(h).sessions.findOne({ userId })).toMatchObject({
      revokedReason: 'signed_out',
    });
    expect((await me(token)).status).toBe(401);
    expect((await panelCall(h, token, 'POST', SIGN_OUT, {})).status).toBe(204);
    expect((await panelCall(h, undefined, 'POST', SIGN_OUT, {})).status).toBe(204);
    const actions = (await panel(h).audit.find().sort({ _id: 1 }).toArray()).map((entry) => [
      entry.action,
      entry.actor,
    ]);
    expect(actions).toEqual([
      ['panel.signed_in', { kind: 'user', userId }],
      ['panel.signed_out', { kind: 'user', userId }],
    ]);
  });
});

describe('гонка: вход в панель проверил старый пароль ↔ сброс пароля закоммичен (AC4)', () => {
  async function signInAcrossReset() {
    const userId = await memberUser(h, ADMIN, 'admin');
    await requestPasswordReset(h, ADMIN);
    const resetToken = await latestResetToken(h, ADMIN);
    const repository = h.app.get(PanelRepository, { strict: false });
    const insert = repository.insertSession.bind(repository);
    const paused = gate();
    vi.spyOn(repository, 'insertSession').mockImplementationOnce(async (tx, doc) => {
      await paused.wait(); // пароль проверен, штамп — от старого хеша
      return insert(tx, doc);
    });

    const signing = panelSignIn(h, ADMIN);
    await paused.reached;
    expect((await confirmPasswordReset(h, resetToken, 'brand-new-password')).status).toBe(200);
    paused.open();
    const res = await signing;
    expect(res.status).toBe(200);
    return { userId, token: panelCookieValue(res) ?? '' };
  }

  it('выданная сессия на первом запросе — 401 (штамп не совпал), отозвана credentials_changed', async () => {
    const { userId, token } = await signInAcrossReset();

    const res = await me(token);

    expect(res.status).toBe(401);
    expect(await panel(h).sessions.findOne({ userId })).toMatchObject({
      revokedReason: 'credentials_changed',
    });
  });

  it('отрицательное доказательство: без сверки штампа та же сессия — 200', async () => {
    const { token } = await signInAcrossReset();
    const session = await panel(h).sessions.findOne({});
    // «гард без сверки»: текущий штамп подменён записанным при входе (во всех экземплярах порта)
    vi.spyOn(IdentityAccounts.prototype, 'accountState').mockResolvedValue({
      active: true,
      credentialsStamp: session?.credentialsStamp ?? '',
    });

    expect((await me(token)).status).toBe(200);
  });
});
