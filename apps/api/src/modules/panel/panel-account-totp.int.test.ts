import { TotpRecoveryCodes, TotpSetup, TotpStatus } from '@pokatim/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type Harness, MINUTE } from '../../../test/harness';
import {
  deviceCookieValue,
  memberUser,
  panel,
  PANEL_TOTP_KEY_TEST,
  panelCall,
  panelCookieValue,
  panelSession,
  panelSignIn,
  panelTotpStep,
  seedTotp,
  totpCode,
} from '../../../test/panel';
import { sha256 } from '../identity';
import { base32Decode } from './totp';

/** 2FA своего аккаунта в настройках панели (ADR-0024, D9). */
const ADMIN = 'olga@example.by';
const MODERATOR = 'mod@example.by';
const BASE = '/v1/admin/account/totp';

const IP = { 'x-forwarded-for': '198.51.100.20' };

function suite(enforced: boolean) {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({
      TRUST_PROXY: '1',
      PANEL_TOTP_KEY: PANEL_TOTP_KEY_TEST,
      PANEL_TOTP_ENFORCED: String(enforced),
    });
  });
  beforeEach(async () => {
    await h.reset();
  });
  afterAll(async () => {
    await h.close();
  });
  return () => h;
}

describe('настройки 2FA (обязательность выключена)', () => {
  const harness = suite(false);
  const post = (token: string, path: string, body?: unknown) =>
    panelCall(harness(), token, 'POST', `${BASE}${path}`, body, IP);

  it('без входа — 401; статус без 2FA — выключена, кодов 0', async () => {
    const h = harness();
    expect((await panelCall(h, undefined, 'GET', BASE)).status).toBe(401);
    await memberUser(h, MODERATOR, 'moderator');
    const token = await panelSession(h, MODERATOR);
    const res = await panelCall(h, token, 'GET', BASE);
    expect(TotpStatus.parse(res.body)).toEqual({
      enabled: false,
      enabledAt: null,
      required: false,
      recoveryCodesLeft: 0,
    });
  });

  it('подключение: setup → повторный setup заменяет секрет → confirm старым — 400, новым — коды и журнал', async () => {
    const h = harness();
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const token = await panelSession(h, MODERATOR);

    const first = TotpSetup.parse((await post(token, '/setup')).body);
    const second = TotpSetup.parse((await post(token, '/setup')).body);
    expect(second.secret).not.toBe(first.secret);

    const stale = await post(token, '/confirm', {
      code: totpCode(h, base32Decode(first.secret)),
    });
    expect(stale.status).toBe(400);
    expect(stale.body).toMatchObject({ code: 'TOTP_INVALID_CODE' });

    const res = await post(token, '/confirm', { code: totpCode(h, base32Decode(second.secret)) });
    expect(res.status).toBe(200);
    expect(TotpRecoveryCodes.parse(res.body).recoveryCodes).toHaveLength(10);
    expect(await panel(h).totp.findOne({ _id: userId })).toMatchObject({ status: 'active' });
    expect(await panel(h).audit.findOne({ action: 'panel.totp_enabled' })).toMatchObject({
      actor: { kind: 'user', userId },
      targetUserId: null,
    });

    const status = TotpStatus.parse((await panelCall(h, token, 'GET', BASE)).body);
    expect(status).toMatchObject({ enabled: true, required: false, recoveryCodesLeft: 10 });
    // сессия, в которой подключили, жива; me видит 2FA
    const me = await panelCall(h, token, 'GET', '/v1/admin/session/me');
    expect(me.body).toMatchObject({ user: { totp: { enabled: true, required: false } } });
  });

  it('setup при активной 2FA — 409 TOTP_ALREADY_ENABLED; confirm без setup — 409 TOTP_NOT_ENABLED', async () => {
    const h = harness();
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const token = await panelSession(h, MODERATOR);
    expect((await post(token, '/confirm', { code: '123456' })).body).toMatchObject({
      code: 'TOTP_NOT_ENABLED',
    });
    await seedTotp(h, userId);
    const res = await post(token, '/setup');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'TOTP_ALREADY_ENABLED' });
  });

  it('перевыпуск кодов — с текущим кодом: прежние коды гаснут, журнал; неверный код — 400', async () => {
    const h = harness();
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const token = await panelSession(h, MODERATOR);
    const { secret, recoveryCodes } = await seedTotp(h, userId);

    const wrong = totpCode(h, secret) === '000000' ? '111111' : '000000';
    expect((await post(token, '/recovery-codes', { code: wrong })).status).toBe(400);
    h.clock.advance(MINUTE);
    const res = await post(token, '/recovery-codes', { code: totpCode(h, secret) });
    expect(res.status).toBe(200);
    const fresh = TotpRecoveryCodes.parse(res.body).recoveryCodes;
    expect(fresh).not.toContain(recoveryCodes[0]);
    expect(await panel(h).audit.countDocuments({ action: 'panel.totp_recovery_regenerated' })).toBe(
      1,
    );

    // старый код восстановления больше не отключает 2FA
    const old = await post(token, '/disable', { recoveryCode: recoveryCodes[0] });
    expect(old.status).toBe(400);
  });

  it('отключение кодом восстановления: 2FA и устройства удалены, журнал, своя сессия жива', async () => {
    const h = harness();
    const userId = await memberUser(h, MODERATOR, 'moderator');
    const { secret, recoveryCodes } = await seedTotp(h, userId);
    // вход с «запомнить устройство»
    const step = await panelSignIn(h, MODERATOR);
    const { challenge } = step.body as { challenge: string };
    const signed = await panelTotpStep(h, 'totp', {
      challenge,
      code: totpCode(h, secret),
      rememberDevice: true,
    });
    const device = deviceCookieValue(signed) ?? '';
    expect(await panel(h).devices.countDocuments({ tokenHash: sha256(device) })).toBe(1);
    const token = panelCookieValue(signed) ?? '';

    const res = await post(token, '/disable', { recoveryCode: recoveryCodes[1] });
    expect(res.status).toBe(204);
    expect(await panel(h).totp.countDocuments({ _id: userId })).toBe(0);
    expect(await panel(h).devices.countDocuments({ userId })).toBe(0);
    expect(await panel(h).audit.findOne({ action: 'panel.totp_disabled' })).toMatchObject({
      actor: { kind: 'user', userId },
    });
    expect((await panelCall(h, token, 'GET', '/v1/admin/session/me')).status).toBe(200);
    // без 2FA вход — сразу сессия
    expect((await panelSignIn(h, MODERATOR)).body).toMatchObject({ state: 'signedIn' });
  });

  it('отключение без 2FA — 409 TOTP_NOT_ENABLED; оба кода сразу — 400', async () => {
    const h = harness();
    await memberUser(h, MODERATOR, 'moderator');
    const token = await panelSession(h, MODERATOR);
    expect((await post(token, '/disable', { code: '123456' })).body).toMatchObject({
      code: 'TOTP_NOT_ENABLED',
    });
    const both = await post(token, '/disable', { code: '123456', recoveryCode: 'abcde-fgh23' });
    expect(both.status).toBe(400);
  });
});

describe('настройки 2FA (PANEL_TOTP_ENFORCED=true)', () => {
  const harness = suite(true);

  it('admin не может отключить себе 2FA — 409 TOTP_REQUIRED; статус required', async () => {
    const h = harness();
    const userId = await memberUser(h, ADMIN, 'admin');
    const { secret } = await seedTotp(h, userId);
    const step = await panelSignIn(h, ADMIN);
    const { challenge } = step.body as { challenge: string };
    const signed = await panelTotpStep(h, 'totp', { challenge, code: totpCode(h, secret) });
    const token = panelCookieValue(signed) ?? '';

    const status = TotpStatus.parse((await panelCall(h, token, 'GET', BASE)).body);
    expect(status.required).toBe(true);
    h.clock.advance(MINUTE);
    const res = await panelCall(
      h,
      token,
      'POST',
      `${BASE}/disable`,
      { code: totpCode(h, secret) },
      IP,
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'TOTP_REQUIRED' });
    expect(await panel(h).totp.countDocuments({ _id: userId })).toBe(1);
  });
});
