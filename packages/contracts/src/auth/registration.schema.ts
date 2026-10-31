import { z } from 'zod';

import { fieldError } from '../common.ts';
import { InviteCode } from '../social/invite.schema.ts';
import { minskToday } from '../time.ts';
import { AnySession, SessionTransport } from './session.schema.ts';
import { OpaqueToken } from './verification.schema.ts';

/** «Сегодня» по Минску для возраста — функция времени платформы (`time.ts`). */
export { minskToday };

export const MIN_AGE_YEARS = 18;
export const MIN_BIRTH_DATE = '1900-01-01';
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;

/** Сравниваем адреса без учёта регистра: так их пишет и ищет сервер. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Полных лет на дату `today`; обе даты — календарные `YYYY-MM-DD`, без часового пояса. */
export function ageInYears(birthDate: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return today.slice(5) >= birthDate.slice(5) ? years : years - 1;
}

/** Пробелы по краям (автоподстановка клавиатуры) срезаются; регистр приводит сервер (`normalizeEmail`). */
export const Email = z
  .string({ error: fieldError('INVALID_EMAIL') })
  .trim()
  .pipe(z.email({ error: 'INVALID_EMAIL' }).max(EMAIL_MAX_LENGTH, { error: 'TOO_LONG' }));

export const Password = z
  .string({ error: fieldError('INVALID') })
  .min(PASSWORD_MIN_LENGTH, { error: 'TOO_SHORT' })
  .max(PASSWORD_MAX_LENGTH, { error: 'TOO_LONG' });

/** Дата рождения из пикера — календарная дата без времени; 18+ — по «сегодня» в Минске. */
export const BirthDate = z.iso
  .date({ error: fieldError('INVALID_DATE'), abort: true })
  .refine((value) => value >= MIN_BIRTH_DATE && value <= minskToday(), {
    error: 'INVALID_DATE',
    abort: true,
  })
  .refine((value) => ageInYears(value, minskToday()) >= MIN_AGE_YEARS, { error: 'AGE_BELOW_18' });

/**
 * `POST /v1/auth/register`. Согласие — одно на обработку данных и соглашение текущей версии. `invite` — код
 * пригласившего (K9, P6): необязателен (старые сборки), неверный формат отбрасывается, а не даёт 400.
 */
export const RegisterRequest = z.object({
  email: Email,
  password: Password,
  birthDate: BirthDate,
  personalDataConsent: z.literal(true, { error: 'CONSENT_REQUIRED' }),
  invite: InviteCode.optional().catch(undefined),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

/** Токен регистрации (ADR-0002): годится только для poll и resend, на сессию меняется один раз. */
export const RegistrationToken = OpaqueToken;

export const RegisterResponse = z.object({
  registrationToken: RegistrationToken,
  email: z.string(),
  resendAvailableInSec: z.number().int().nonnegative(),
});
export type RegisterResponse = z.infer<typeof RegisterResponse>;

/**
 * `POST /v1/auth/registration/poll` — экран «Подтвердите e-mail» ждёт подтверждения. `sessionTransport` —
 * как выдать сессию (`body` по умолчанию: старые сборки native поля не шлют).
 */
export const RegistrationPollRequest = z.object({
  registrationToken: RegistrationToken,
  sessionTransport: SessionTransport.optional(),
});
export type RegistrationPollRequest = z.infer<typeof RegistrationPollRequest>;

export const RegistrationPollResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending') }),
  /** `Session` для `body`, `CookieSession` (refresh — в cookie) для `cookie`. */
  z.object({ state: z.literal('verified'), session: AnySession }),
]);
export type RegistrationPollResponse = z.infer<typeof RegistrationPollResponse>;
