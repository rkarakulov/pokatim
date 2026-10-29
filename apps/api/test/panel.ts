import { PANEL_SESSION_COOKIE, type PanelRole } from '@pokatim/contracts';

import { panelCollections } from '../src/modules/panel/panel.collection';
import type { Harness } from './harness';
import {
  activeLinkToken,
  call,
  type CallResult,
  confirm,
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
