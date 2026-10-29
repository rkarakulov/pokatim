import { z } from 'zod';

import { fieldError } from '../common.ts';
import { OpaqueToken } from '../auth/verification.schema.ts';
import { ActionReason } from './members.schema.ts';

/**
 * 2FA панели «Протокол» (TOTP, RFC 6238; ADR-0023): шаг кода после пароля, подключение, коды восстановления, сброс.
 * Параметры приложения-аутентификатора — SHA-1, 6 цифр, 30 с (по умолчанию у всех приложений).
 */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;
/** Кодов восстановления в наборе: показываются один раз при подключении и перевыпуске. */
export const RECOVERY_CODE_COUNT = 10;
/** Издатель в приложении-аутентификаторе (`issuer` и префикс метки otpauth). */
export const TOTP_ISSUER = 'Покатим Протокол';

/** Код из приложения: ровно 6 цифр (пробелы клиент убирает до отправки). */
export const TotpCode = z
  .string({ error: fieldError('REQUIRED') })
  .regex(/^\d{6}$/, { error: 'INVALID' });
export type TotpCode = z.infer<typeof TotpCode>;

/**
 * Код восстановления `xxxxx-xxxxx` (base32: `a–z`, `2–7`; 50 бит), регистр и дефис — по желанию: сервер нормализует
 * (нижний регистр, без дефиса).
 */
export const RecoveryCode = z
  .string({ error: fieldError('REQUIRED') })
  .regex(/^[a-z2-7]{5}-?[a-z2-7]{5}$/i, { error: 'INVALID' });
export type RecoveryCode = z.infer<typeof RecoveryCode>;

/** Вызов второго шага входа: непрозрачный токен (32 байта base64url), 5 минут, одноразовый. */
export const SignInChallenge = OpaqueToken;
export type SignInChallenge = z.infer<typeof SignInChallenge>;

/** «Запомнить это устройство на 30 дней»: пропускает только шаг кода, пароль — всегда. */
const RememberDevice = z.boolean({ error: fieldError('INVALID') }).default(false);

/**
 * `POST /v1/admin/session/sign-in/totp` — второй шаг входа: ровно одно из `code` (TOTP) и `recoveryCode`. Ответ —
 * `PanelSignedIn` (cookie сессии; при `rememberDevice` — и cookie устройства). Ошибки: 400 `TOTP_INVALID_CODE`
 * (неверный, повторённый или погашенный код — одно сообщение), 401 `TOTP_CHALLENGE_EXPIRED`, 429, 503
 * `TOTP_UNAVAILABLE`.
 */
export const TotpSignInRequest = z.union([
  z.strictObject({ challenge: SignInChallenge, code: TotpCode, rememberDevice: RememberDevice }),
  z.strictObject({
    challenge: SignInChallenge,
    recoveryCode: RecoveryCode,
    rememberDevice: RememberDevice,
  }),
]);
export type TotpSignInRequest = z.infer<typeof TotpSignInRequest>;

/** `POST /v1/admin/session/sign-in/totp-setup` — подключение 2FA на экране входа (`totpSetupRequired`). */
export const TotpSetupStartRequest = z.strictObject({ challenge: SignInChallenge });
export type TotpSetupStartRequest = z.infer<typeof TotpSetupStartRequest>;

/** `POST /v1/admin/session/sign-in/totp-setup/confirm` — первый код нового секрета; ответ — с кодами восстановления. */
export const TotpSetupConfirmRequest = z.strictObject({
  challenge: SignInChallenge,
  code: TotpCode,
  rememberDevice: RememberDevice,
});
export type TotpSetupConfirmRequest = z.infer<typeof TotpSetupConfirmRequest>;

/**
 * Новый секрет — только до подтверждения (потом сервер его не отдаёт): base32 для ручного ввода и `otpauth://` для
 * QR.
 */
export const TotpSetup = z.object({
  secret: z.string().regex(/^[A-Z2-7]+$/),
  otpauthUri: z.string().startsWith('otpauth://totp/'),
});
export type TotpSetup = z.infer<typeof TotpSetup>;

/** Набор кодов восстановления (`xxxxx-xxxxx`) — показывается один раз. */
export const RecoveryCodes = z.array(z.string()).length(RECOVERY_CODE_COUNT);
export type RecoveryCodes = z.infer<typeof RecoveryCodes>;

/** Ответ подтверждения подключения и перевыпуска кодов в настройках. */
export const TotpRecoveryCodes = z.object({ recoveryCodes: RecoveryCodes });
export type TotpRecoveryCodes = z.infer<typeof TotpRecoveryCodes>;

/**
 * `GET /v1/admin/account/totp` — 2FA своего аккаунта: `required` — сервер не даст отключить (admin при
 * `PANEL_TOTP_ENFORCED`), `recoveryCodesLeft` — непогашенные коды.
 */
export const TotpStatus = z.object({
  enabled: z.boolean(),
  enabledAt: z.iso.datetime().nullable(),
  required: z.boolean(),
  recoveryCodesLeft: z.number().int().nonnegative(),
});
export type TotpStatus = z.infer<typeof TotpStatus>;

/**
 * `POST /v1/admin/account/totp/confirm` (подтверждение подключения) и `…/recovery-codes` (перевыпуск кодов) — код
 * из приложения.
 */
export const TotpCodeRequest = z.strictObject({ code: TotpCode });
export type TotpCodeRequest = z.infer<typeof TotpCodeRequest>;

/** `POST /v1/admin/account/totp/disable` — ровно одно из `code` и `recoveryCode`; 204. */
export const TotpDisableRequest = z.union([
  z.strictObject({ code: TotpCode }),
  z.strictObject({ recoveryCode: RecoveryCode }),
]);
export type TotpDisableRequest = z.infer<typeof TotpDisableRequest>;

/** `POST /v1/admin/members/:userId/totp/reset` (`members.manage`) — сброс 2FA сотрудника, причина обязательна; 204. */
export const TotpResetRequest = z.strictObject({ reason: ActionReason });
export type TotpResetRequest = z.infer<typeof TotpResetRequest>;
