import {
  PanelSignedIn,
  PanelSignedInWithRecoveryCodes,
  PanelSignInResponse,
  TotpSetup,
} from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, DAY, type Harness, MINUTE } from '../../../test/harness';
import {
  confirmPasswordReset,
  latestResetToken,
  requestPasswordReset,
} from '../../../test/identity';
import {
  deviceCookie,
  deviceCookieValue,
  deviceSetCookie,
  memberUser,
  panel,
  PANEL_TOTP_KEY_TEST,
  panelCall,
  panelCookieValue,
  panelSignIn,
  panelTotpStep,
  seedTotp,
  totpCode,
} from '../../../test/panel';
import { sha256 } from '../identity';
import { base32Decode, generateTotp, totpStep } from './totp';

/** Вход в панель со вторым фактором (ADR-0024, AC test matrix «вход»). */
const ADMIN = 'olga@example.by';
const MODERATOR = 'mod@example.by';

async function challengeOf(h: Harness, email: string, headers: Record<string, string> = {}) {
  const res = await panelSignIn(h, email, undefined, headers);
  expect(res.status).toBe(200);
  const body = PanelSignInResponse.parse(res.body);
  if (body.state !== 'totpRequired' && body.state !== 'totpSetupRequired') {
    throw new Error(`ожидался вызов, пришло ${body.state}`);
  }
  return body;
}

describe('вход с 2FA (ключ задан, обязательность выключена)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ TRUST_PROXY: '1', PANEL_TOTP_KEY: PANEL_TOTP_KEY_TEST });
  });
  beforeEach(async () => {
    await h.reset();
  });
  afterAll(async () => {
    await h.close();
  });

  it('без 2FA — сессия сразу (secondFactor null), admin при выключенном флаге — тоже', async () => {
    await memberUser(h, ADMIN, 'admin');
    const res = await panelSignIn(h, ADMIN);
    expect(PanelSignInResponse.parse(res.body)).toMatchObject({
      state: 'signedIn',
      me: { user: { totp: { enabled: false, required: false } } },
    });
    expect(await panel(h).sessions.findOne({})).toMatchObject({ secondFactor: null });
  });

  it('с 2FA: пароль → вызов (без cookie и сессии) → код → сессия secondFactor totp; повтор кода — 400', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);

    const step1 = await panelSignIn(h, MODERATOR);
    expect(step1.headers['set-cookie']).toBeUndefined();
    const body = PanelSignInResponse.parse(step1.body);
    expect(body).toMatchObject({ state: 'totpRequired', expiresInSec: 300 });
    if (body.state !== 'totpRequired') throw new Error();
    expect(await panel(h).sessions.countDocuments()).toBe(0);
    expect(await panel(h).challenges.findOne({})).toMatchObject({
      tokenHash: sha256(body.challenge),
      userId,
      purpose: 'totp',
      attempts: 0,
    });

    const code = totpCode(h, secret);
    const done = await panelTotpStep(h, 'totp', { challenge: body.challenge, code });
    expect(done.status).toBe(200);
    expect(PanelSignedIn.parse(done.body)).toMatchObject({
      me: { user: { id: userId, totp: { enabled: true, required: false } } },
    });
    const token = panelCookieValue(done) ?? '';
    expect(await panel(h).sessions.findOne({ tokenHash: sha256(token) })).toMatchObject({
      secondFactor: 'totp',
    });
    expect(deviceSetCookie(done)).toBeUndefined();
    expect(await panel(h).challenges.countDocuments()).toBe(0);
    expect(await panel(h).totp.findOne({ _id: userId })).toMatchObject({
      lastUsedStep: totpStep(h.clock.now()),
    });
    expect((await panelCall(h, token, 'GET', '/v1/admin/session/me')).status).toBe(200);

    // тот же код в новом вызове — повтор шага
    const again = await challengeOf(h, MODERATOR);
    const replay = await panelTotpStep(h, 'totp', { challenge: again.challenge, code });
    expect(replay.status).toBe(400);
    expect(replay.body).toMatchObject({ code: 'TOTP_INVALID_CODE' });
    // прошлый шаг после принятого — тоже
    const previous = generateTotp(secret, totpStep(h.clock.now()) - 1);
    const old = await panelTotpStep(h, 'totp', { challenge: again.challenge, code: previous });
    expect(old.status).toBe(400);
  });

  it('код восстановления: вход, гашение (повтор — 400), журнал totp_recovery_used; secondFactor recovery', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { recoveryCodes } = await seedTotp(h, userId);
    const [first = ''] = recoveryCodes;

    const { challenge } = await challengeOf(h, MODERATOR);
    const res = await panelTotpStep(h, 'totp', {
      challenge,
      recoveryCode: first.toUpperCase().replace('-', ''),
    });
    expect(res.status).toBe(200);
    expect(await panel(h).sessions.findOne({})).toMatchObject({ secondFactor: 'recovery' });
    const doc = await panel(h).totp.findOne({ _id: userId });
    expect(doc?.recoveryCodes.filter((code) => code.usedAt !== null)).toHaveLength(1);
    const audit = await panel(h)
      .audit.find({}, { sort: { _id: 1 } })
      .toArray();
    expect(audit.map((entry) => entry.action)).toEqual([
      'panel.totp_recovery_used',
      'panel.signed_in',
    ]);
    expect(JSON.stringify(audit)).not.toContain(first);

    const second = await challengeOf(h, MODERATOR);
    const reuse = await panelTotpStep(h, 'totp', {
      challenge: second.challenge,
      recoveryCode: first,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body).toMatchObject({ code: 'TOTP_INVALID_CODE' });
  });

  it('5 неверных кодов гасят вызов (дальше — 401), сессии нет', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);
    const { challenge } = await challengeOf(h, MODERATOR);
    const wrong = totpCode(h, secret) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const res = await panelTotpStep(h, 'totp', { challenge, code: wrong });
      expect(res.status).toBe(400);
    }
    expect(await panel(h).challenges.countDocuments()).toBe(0);
    const res = await panelTotpStep(h, 'totp', { challenge, code: totpCode(h, secret) });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'TOTP_CHALLENGE_EXPIRED' });
    expect(await panel(h).sessions.countDocuments()).toBe(0);
  });

  it('вызов истёк (5 мин) или неизвестен — 401 TOTP_CHALLENGE_EXPIRED', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);
    const { challenge } = await challengeOf(h, MODERATOR);
    h.clock.advance(5 * MINUTE + 1);
    const expired = await panelTotpStep(h, 'totp', { challenge, code: totpCode(h, secret) });
    expect(expired.status).toBe(401);
    expect(expired.body).toMatchObject({ code: 'TOTP_CHALLENGE_EXPIRED' });
    const unknown = await panelTotpStep(h, 'totp', {
      challenge: 'x'.repeat(43),
      code: totpCode(h, secret),
    });
    expect(unknown.status).toBe(401);
  });

  it('смена пароля между шагами — 401, вызов погашен', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);
    const { challenge } = await challengeOf(h, MODERATOR);
    await requestPasswordReset(h, MODERATOR);
    const token = await latestResetToken(h, MODERATOR);
    expect((await confirmPasswordReset(h, token, 'brand-new-password')).status).toBe(200);

    const res = await panelTotpStep(h, 'totp', { challenge, code: totpCode(h, secret) });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'TOTP_CHALLENGE_EXPIRED' });
    expect(await panel(h).challenges.countDocuments()).toBe(0);
    expect(await panel(h).sessions.countDocuments()).toBe(0);
  });

  it('лимит попыток кода по сотруднику — 429 RATE_LIMITED с retryAfterSec (код не проверяется)', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);
    const wrong = totpCode(h, secret) === '000000' ? '111111' : '000000';
    for (let round = 0; round < 2; round += 1) {
      const { challenge } = await challengeOf(h, MODERATOR);
      for (let i = 0; i < 5; i += 1) {
        expect((await panelTotpStep(h, 'totp', { challenge, code: wrong })).status).toBe(400);
      }
    }
    const { challenge } = await challengeOf(h, MODERATOR);
    const limited = await panelTotpStep(h, 'totp', { challenge, code: totpCode(h, secret) });
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSec: expect.any(Number) },
    });
    expect(await panel(h).sessions.countDocuments()).toBe(0);
  });

  it('«запомнить устройство»: cookie §D4, следующий вход — сразу сессия (device); после смены пароля — снова код', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);
    const { challenge } = await challengeOf(h, MODERATOR);
    const res = await panelTotpStep(h, 'totp', {
      challenge,
      code: totpCode(h, secret),
      rememberDevice: true,
    });
    expect(res.status).toBe(200);
    const cookie = deviceSetCookie(res) ?? '';
    const device = deviceCookieValue(res) ?? '';
    expect(device).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/v1/admin/session']) {
      expect(cookie).toContain(part);
    }
    expect(cookie).toContain(`Max-Age=${30 * 24 * 3600}`);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(await panel(h).devices.findOne({})).toMatchObject({
      tokenHash: sha256(device),
      userId,
    });

    const trusted = await panelSignIn(h, MODERATOR, undefined, deviceCookie(device));
    expect(PanelSignInResponse.parse(trusted.body).state).toBe('signedIn');
    expect(
      await panel(h).sessions.findOne({ tokenHash: sha256(panelCookieValue(trusted) ?? '') }),
    ).toMatchObject({ secondFactor: 'device' });

    // устройство не пропускает пароль: неверный пароль — 401
    const wrongPassword = await panelSignIn(
      h,
      MODERATOR,
      'wrong-password-123',
      deviceCookie(device),
    );
    expect(wrongPassword.status).toBe(401);

    await requestPasswordReset(h, MODERATOR);
    const token = await latestResetToken(h, MODERATOR);
    await confirmPasswordReset(h, token, 'brand-new-password');
    const after = await panelSignIn(h, MODERATOR, 'brand-new-password', deviceCookie(device));
    expect(PanelSignInResponse.parse(after.body).state).toBe('totpRequired');
  });

  it('устройство после повторного подключения 2FA (новая эпоха) и после срока — снова код', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);
    const { challenge } = await challengeOf(h, MODERATOR);
    const res = await panelTotpStep(h, 'totp', {
      challenge,
      code: totpCode(h, secret),
      rememberDevice: true,
    });
    const device = deviceCookieValue(res) ?? '';

    await panel(h).totp.updateOne({ _id: userId }, { $set: { epoch: 'другая-эпоха' } });
    const reEnrolled = await panelSignIn(h, MODERATOR, undefined, deviceCookie(device));
    expect(PanelSignInResponse.parse(reEnrolled.body).state).toBe('totpRequired');

    await panel(h).totp.deleteOne({ _id: userId });
    const fresh = await seedTotp(h, userId);
    const second = await challengeOf(h, MODERATOR);
    const remembered = await panelTotpStep(h, 'totp', {
      challenge: second.challenge,
      code: totpCode(h, fresh.secret),
      rememberDevice: true,
    });
    const device2 = deviceCookieValue(remembered) ?? '';
    h.clock.advance(30 * DAY + 1);
    const expired = await panelSignIn(h, MODERATOR, undefined, deviceCookie(device2));
    expect(PanelSignInResponse.parse(expired.body).state).toBe('totpRequired');
  });

  it('не больше 10 доверенных устройств: старые вытесняются', async () => {
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret } = await seedTotp(h, userId);
    const tokens: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      h.clock.advance(MINUTE);
      const { challenge } = await challengeOf(h, MODERATOR, {
        'x-forwarded-for': `198.51.100.${i}`,
      });
      const res = await panelTotpStep(h, 'totp', {
        challenge,
        code: totpCode(h, secret),
        rememberDevice: true,
      });
      expect(res.status).toBe(200);
      tokens.push(deviceCookieValue(res) ?? '');
      h.clock.advance(MINUTE);
      if (i === 3) h.clock.advance(15 * MINUTE); // лимиты входа и кода — в своём окне
      if (i === 7) h.clock.advance(15 * MINUTE);
    }
    const docs = await panel(h).devices.find({ userId }).toArray();
    expect(docs).toHaveLength(10);
    expect(docs.map((doc) => doc.tokenHash)).not.toContain(sha256(tokens[0] ?? ''));
  });
});

describe('обязательная 2FA для admin (PANEL_TOTP_ENFORCED=true)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({
      TRUST_PROXY: '1',
      PANEL_TOTP_KEY: PANEL_TOTP_KEY_TEST,
      PANEL_TOTP_ENFORCED: 'true',
    });
  });
  beforeEach(async () => {
    await h.reset();
  });
  afterAll(async () => {
    await h.close();
  });

  it('admin без 2FA: totpSetupRequired → setup → confirm → сессия + 10 кодов, журнал totp_enabled', async () => {
    const userId = await memberUser(h, ADMIN, 'admin');
    const step = await challengeOf(h, ADMIN);
    expect(step.state).toBe('totpSetupRequired');
    expect(await panel(h).sessions.countDocuments()).toBe(0);

    // код к вызову подключения не принимается
    const wrongPurpose = await panelTotpStep(h, 'totp', {
      challenge: step.challenge,
      code: '123456',
    });
    expect(wrongPurpose.status).toBe(401);

    const setupRes = await panelTotpStep(h, 'totp-setup', { challenge: step.challenge });
    expect(setupRes.status).toBe(200);
    const setup = TotpSetup.parse(setupRes.body);
    expect(setup.otpauthUri).toContain('olga%40example.by');
    const doc = await panel(h).totp.findOne({ _id: userId });
    expect(doc).toMatchObject({ status: 'pending' });
    expect(doc?.secretEnc).toMatch(/^v1:/);
    expect(JSON.stringify(doc)).not.toContain(setup.secret);

    const secret = base32Decode(setup.secret);
    const confirm = await panelTotpStep(h, 'totp-setup/confirm', {
      challenge: step.challenge,
      code: totpCode(h, secret),
    });
    expect(confirm.status).toBe(200);
    const body = PanelSignedInWithRecoveryCodes.parse(confirm.body);
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.me.user.totp).toEqual({ enabled: true, required: true });
    expect(await panel(h).sessions.findOne({})).toMatchObject({ secondFactor: 'totp' });
    expect(await panel(h).totp.findOne({ _id: userId })).toMatchObject({ status: 'active' });
    const actions = (
      await panel(h)
        .audit.find({}, { sort: { _id: 1 } })
        .toArray()
    ).map((entry) => entry.action);
    expect(actions).toEqual(['panel.totp_enabled', 'panel.signed_in']);

    // следующий вход — обычный шаг кода
    h.clock.advance(MINUTE);
    expect((await challengeOf(h, ADMIN)).state).toBe('totpRequired');
  });

  it('confirm с неверным кодом — 400, 2FA не включена; moderator без 2FA — сессия сразу', async () => {
    await memberUser(h, ADMIN, 'admin');
    const step = await challengeOf(h, ADMIN);
    await panelTotpStep(h, 'totp-setup', { challenge: step.challenge });
    const res = await panelTotpStep(h, 'totp-setup/confirm', {
      challenge: step.challenge,
      code: '000000',
    });
    expect([400]).toContain(res.status);
    expect(await panel(h).sessions.countDocuments()).toBe(0);

    await memberUser(h, MODERATOR, 'moderator');
    const mod = await panelSignIn(h, MODERATOR);
    expect(PanelSignInResponse.parse(mod.body)).toMatchObject({
      state: 'signedIn',
      me: { user: { totp: { enabled: false, required: false } } },
    });
  });
});

describe('2FA без ключа на сервере — fail closed', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ TRUST_PROXY: '1' });
  });
  afterAll(async () => {
    await h.close();
  });

  it('вход сотрудника с 2FA — 503 TOTP_UNAVAILABLE, сессии нет', async () => {
    await h.reset();
    const userId = await memberUser(h, MODERATOR, 'moderator');
    await seedTotp(h, userId);
    const res = await panelSignIn(h, MODERATOR);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'TOTP_UNAVAILABLE' });
    expect(await panel(h).sessions.countDocuments()).toBe(0);
  });
});
