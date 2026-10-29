import { PANEL_DEVICE_COOKIE, PANEL_SESSION_COOKIE, type PanelRole } from '@pokatim/contracts';
import { uuidv7 } from '@rkarakulov/api-kit/mongo';
import { vi } from 'vitest';

import { panelCollections } from '../src/modules/panel/panel.collection';
import { PanelRepository } from '../src/modules/panel/panel.repository';
import { PanelTotpCodes } from '../src/modules/panel/panel-totp-codes';
import { generateRecoveryCodes, recoveryCodeHash } from '../src/modules/panel/recovery-codes';
import { generateTotp, generateTotpSecret, totpStep } from '../src/modules/panel/totp';
import { panelTotpKeys, sealTotpSecret } from '../src/modules/panel/totp-secret-box';
import type { Harness } from './harness';
import {
  activeLinkToken,
  call,
  type CallResult,
  confirm,
  gate,
  register,
  userIdByEmail,
  validRegistration,
} from './identity';

export const PANEL_PASSWORD = validRegistration().password;

/** Коллекции панели тестовой БД. */
export const panel = (h: Harness) => panelCollections(h.db);

/** Подтверждённый пользователь приложения; возвращает его id. */
export async function verifiedUser(h: Harness, email: string): Promise<string> {
  await register(h, { email });
  await confirm(h, await activeLinkToken(h, email));
  return userIdByEmail(h, email);
}

/** Член команды напрямую в БД (подготовка теста, не проверяемое действие). */
export async function seedMember(
  h: Harness,
  userId: string,
  role: PanelRole,
  overrides: { status?: 'active' | 'revoked'; displayName?: string } = {},
): Promise<void> {
  await panel(h).members.insertOne({
    _id: userId,
    role,
    status: overrides.status ?? 'active',
    displayName: overrides.displayName ?? `Сотрудник ${role}`,
    grantedAt: h.clock.now(),
    revokedAt: overrides.status === 'revoked' ? h.clock.now() : null,
    version: 0,
  });
}

/** Подтверждённый пользователь с ролью панели. */
export async function memberUser(h: Harness, email: string, role: PanelRole): Promise<string> {
  const userId = await verifiedUser(h, email);
  await seedMember(h, userId, role);
  return userId;
}

/** Все Set-Cookie ответа. */
export function setCookies(res: CallResult): string[] {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header.map(String) : header === undefined ? [] : [String(header)];
}

/** Set-Cookie панели (или undefined). */
export const panelSetCookie = (res: CallResult) =>
  setCookies(res).find((value) => value.startsWith(`${PANEL_SESSION_COOKIE.name}=`));

/** Значение cookie панели из ответа. */
export const panelCookieValue = (res: CallResult) =>
  panelSetCookie(res)
    ?.split(';')[0]
    ?.slice(PANEL_SESSION_COOKIE.name.length + 1);

/** Заголовок Cookie с токеном панели. */
export const panelCookie = (token: string) => ({
  cookie: `${PANEL_SESSION_COOKIE.name}=${token}`,
});

/** Вход в панель «с IP клиента» за прокси (стенд с `TRUST_PROXY=1`). */
export const panelSignIn = (
  h: Harness,
  email: string,
  password = PANEL_PASSWORD,
  headers: Record<string, string> = {},
  ip = '198.51.100.20',
) =>
  call(
    h,
    'POST',
    '/v1/admin/session/sign-in',
    { email, password },
    {
      'x-forwarded-for': ip,
      ...headers,
    },
  );

/** Вход и токен cookie панели (тест знает, что вход успешен). */
export async function panelSession(h: Harness, email: string): Promise<string> {
  const res = await panelSignIn(h, email);
  const token = panelCookieValue(res);
  if (res.status !== 200 || !token) throw new Error(`вход в панель: ${res.status}`);
  return token;
}

/** Запрос API панели с cookie. */
export const panelCall = (
  h: Harness,
  token: string | undefined,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) => call(h, method, url, payload, { ...(token ? panelCookie(token) : {}), ...headers });

/** Ключ 2FA панели тестового стенда (`PANEL_TOTP_KEY`, hex 64) — фиктивный. */
export const PANEL_TOTP_KEY_TEST = 'ab'.repeat(32);
const TOTP_KEYS = panelTotpKeys(Buffer.from(PANEL_TOTP_KEY_TEST, 'hex'));

/** Активная 2FA сотрудника напрямую в БД (подготовка теста): секрет и коды восстановления — тесту. */
export async function seedTotp(
  h: Harness,
  userId: string,
): Promise<{ secret: Buffer; recoveryCodes: string[]; epoch: string }> {
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const epoch = uuidv7();
  await panel(h).totp.insertOne({
    _id: userId,
    status: 'active',
    secretEnc: sealTotpSecret(TOTP_KEYS.enc, userId, secret),
    lastUsedStep: null,
    recoveryCodes: recoveryCodes.map((code) => ({
      hash: recoveryCodeHash(TOTP_KEYS.hmac, code),
      usedAt: null,
    })),
    enabledAt: h.clock.now(),
    epoch,
    updatedAt: h.clock.now(),
  });
  return { secret, recoveryCodes, epoch };
}

/** Код TOTP на часах стенда (`offset` — шаги по 30 с). */
export const totpCode = (h: Harness, secret: Buffer, offset = 0) =>
  generateTotp(secret, totpStep(h.clock.now()) + offset);

/** Set-Cookie устройства (или undefined) и её значение. */
export const deviceSetCookie = (res: CallResult) =>
  setCookies(res).find((value) => value.startsWith(`${PANEL_DEVICE_COOKIE.name}=`));
export const deviceCookieValue = (res: CallResult) =>
  deviceSetCookie(res)
    ?.split(';')[0]
    ?.slice(PANEL_DEVICE_COOKIE.name.length + 1);
export const deviceCookie = (token: string) => ({
  cookie: `${PANEL_DEVICE_COOKIE.name}=${token}`,
});

/** Второй шаг входа «с IP клиента». */
export const panelTotpStep = (
  h: Harness,
  path: 'totp' | 'totp-setup' | 'totp-setup/confirm',
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  ip = '198.51.100.20',
) =>
  call(h, 'POST', `/v1/admin/session/sign-in/${path}`, body, { 'x-forwarded-for': ip, ...headers });

/** Репозиторий панели графа API (spy в тестах гонок). */
export const panelRepository = (h: Harness) => h.app.get(PanelRepository, { strict: false });

/**
 * Ворота после чтения 2FA (`PanelRepository.findTotp`): следующий вызов читает документ и ждёт, пока тест меняет 2FA
 * (гонка «проверка кода по прочитанному документу → запись»).
 */
export function pauseAfterTotpRead(h: Harness) {
  const g = gate();
  const repository = panelRepository(h);
  const original = repository.findTotp.bind(repository);
  vi.spyOn(repository, 'findTotp').mockImplementationOnce(async (...args) => {
    const doc = await original(...args);
    await g.wait();
    return doc;
  });
  return g;
}

/** Счётчик проверок кода TOTP (`PanelTotpCodes.matchTotp`) — сколько попыток дошло до проверки. */
export function countTotpChecks(h: Harness) {
  const codes = h.app.get(PanelTotpCodes, { strict: false });
  return vi.spyOn(codes, 'matchTotp');
}
