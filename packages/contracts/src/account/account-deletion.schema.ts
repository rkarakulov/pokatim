import { z } from 'zod';

import { SignInPassword } from '../auth/sign-in.schema.ts';

/**
 * `POST /v1/account/delete` — удаление своего аккаунта (за входом). Подтверждение — текущий пароль с тем же пределом
 * длины, что у входа. Пользователь — из сессии, не из тела: лишние ключи — 400. Ответ — `204` без тела.
 * Отказы: `403 PASSWORD_INCORRECT` (неверный пароль), `409 ACCOUNT_PANEL_MEMBER` (член команды панели),
 * `429 RATE_LIMITED`.
 */
export const DeleteAccountRequest = z.strictObject({ password: SignInPassword });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;
