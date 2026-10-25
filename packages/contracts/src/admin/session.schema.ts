import { z } from 'zod';

import { Uuid } from '../common.ts';
import { Email, RegistrationToken } from '../auth/registration.schema.ts';
import { SignInPassword } from '../auth/sign-in.schema.ts';
import { PanelRole, Permission } from './permissions.schema.ts';

/**
 * Cookie сессии панели (ADR-0009): непрозрачный токен, `HttpOnly; Secure; SameSite=Strict`, без `Domain`. Путь —
 * только API панели: cookie не уходит на `/v1/auth/*`, а cookie приложения (`SESSION_COOKIE`) — на `/v1/admin/*`.
 */
export const PANEL_SESSION_COOKIE = {
  name: '__Secure-pokatim_admin_sid',
  path: '/v1/admin',
} as const;

/**
 * `POST /v1/admin/session/sign-in` — вход в панель тем же e-mail и паролем, что в приложении (D-13). Сессия приложения
 * панель не открывает: вход — всегда повторный ввод пароля. Лишние ключи — 400.
 */
export const PanelSignInRequest = z.strictObject({ email: Email, password: SignInPassword });
export type PanelSignInRequest = z.infer<typeof PanelSignInRequest>;

/** `GET /v1/admin/session/me` — «кто я и что могу»: права — итог карты ролей сервера. */
export const PanelMe = z.object({
  user: z.object({
    id: Uuid,
    displayName: z.string(),
    email: z.string(),
    role: PanelRole,
  }),
  permissions: z.array(Permission),
});
export type PanelMe = z.infer<typeof PanelMe>;

/**
 * `signedIn` — cookie панели выставлена, в теле `PanelMe`. `verificationRequired` — пароль верный, e-mail не
 * подтверждён: сессии нет, новый токен регистрации для «Отправить письмо ещё раз» (как у входа приложения).
 * Ошибки: 401 `INVALID_CREDENTIALS` (тело как у приложения), 403 `PANEL_ACCESS_DENIED` (верный пароль, роли нет), 429.
 */
export const PanelSignInResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('signedIn'), me: PanelMe }),
  z.object({
    state: z.literal('verificationRequired'),
    registrationToken: RegistrationToken,
    email: z.string(),
    resendAvailableInSec: z.number().int().nonnegative(),
  }),
]);
export type PanelSignInResponse = z.infer<typeof PanelSignInResponse>;
