import { z } from 'zod';

import { Uuid } from '../common.ts';
import { Email, RegistrationToken } from '../auth/registration.schema.ts';
import { SignInPassword } from '../auth/sign-in.schema.ts';
import { PanelRole, Permission } from './permissions.schema.ts';
import { RecoveryCodes, SignInChallenge } from './totp.schema.ts';

/**
 * Cookie сессии панели (ADR-0009): непрозрачный токен, `HttpOnly; Secure; SameSite=Strict`, без `Domain`. Путь —
 * только API панели: cookie не уходит на `/v1/auth/*`, а cookie приложения (`SESSION_COOKIE`) — на `/v1/admin/*`.
 */
export const PANEL_SESSION_COOKIE = {
  name: '__Secure-pokatim_admin_sid',
  path: '/v1/admin',
} as const;

/**
 * Cookie доверенного устройства панели (2FA, ADR-0024): «запомнить на 30 дней» пропускает только шаг кода. Путь —
 * только сессия панели (вход), `HttpOnly; Secure; SameSite=Strict`, без `Domain`.
 */
export const PANEL_DEVICE_COOKIE = {
  name: '__Secure-pokatim_admin_device',
  path: '/v1/admin/session',
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
    /** 2FA сотрудника: `required` — подключение обязательно (admin при `PANEL_TOTP_ENFORCED`). */
    totp: z.object({ enabled: z.boolean(), required: z.boolean() }),
  }),
  permissions: z.array(Permission),
});
export type PanelMe = z.infer<typeof PanelMe>;

/** Вход завершён: cookie панели выставлена, в теле `PanelMe` (ответ и второго шага `sign-in/totp`). */
export const PanelSignedIn = z.object({ state: z.literal('signedIn'), me: PanelMe });
export type PanelSignedIn = z.infer<typeof PanelSignedIn>;

/** Ответ `sign-in/totp-setup/confirm`: вход завершён, коды восстановления — один раз. */
export const PanelSignedInWithRecoveryCodes = PanelSignedIn.extend({
  recoveryCodes: RecoveryCodes,
});
export type PanelSignedInWithRecoveryCodes = z.infer<typeof PanelSignedInWithRecoveryCodes>;

/**
 * `signedIn` — cookie панели выставлена, в теле `PanelMe`. `verificationRequired` — пароль верный, e-mail не
 * подтверждён: сессии нет, новый токен регистрации для «Отправить письмо ещё раз» (как у входа приложения).
 * `totpRequired` — у сотрудника 2FA: шаг кода (`sign-in/totp`) с вызовом `challenge`; `totpSetupRequired` — admin без
 * 2FA при обязательной 2FA: подключение на экране входа (`sign-in/totp-setup`). Сессии до второго шага нет.
 * Ошибки: 401 `INVALID_CREDENTIALS` (тело как у приложения), 403 `PANEL_ACCESS_DENIED` (верный пароль, роли нет), 429,
 * 503 `TOTP_UNAVAILABLE`.
 */
export const PanelSignInResponse = z.discriminatedUnion('state', [
  PanelSignedIn,
  z.object({
    state: z.literal('verificationRequired'),
    registrationToken: RegistrationToken,
    email: z.string(),
    resendAvailableInSec: z.number().int().nonnegative(),
  }),
  z.object({
    state: z.literal('totpRequired'),
    challenge: SignInChallenge,
    expiresInSec: z.number().int().positive(),
  }),
  z.object({
    state: z.literal('totpSetupRequired'),
    challenge: SignInChallenge,
    expiresInSec: z.number().int().positive(),
  }),
]);
export type PanelSignInResponse = z.infer<typeof PanelSignInResponse>;
