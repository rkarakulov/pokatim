import { z } from 'zod';

import { MIN_AGE_YEARS } from '../auth/registration.schema.ts';
import { fieldError, tolerantEnum } from '../common.ts';
import { RIDER_GENDERS } from '../results/results.schema.ts';
import { minskToday } from '../time.ts';

/*
 * Анкета зачёта Verified (race-results-07): пол и год рождения — для группы зачёта (пол × возраст), вес, рост и FTP —
 * для будущих правил зачёта. Значения видит только владелец (`no-store`); в панель — только пол и год в диалоге
 * правки admin. Группу считает сервер.
 */

/**
 * Версия текста согласия на обработку анкеты (i18n `profile.verified.consent`). Сменили формулировку — подняли
 * версию (дата). Пишет сервер в документ анкеты; клиент присылает только `consent: true`.
 */
export const VERIFIED_PROFILE_CONSENT_VERSION = '2026-10-27';

/** Пределы анкеты (целые, включительно). */
export const VERIFIED_LIMITS = {
  weightKg: [30, 200],
  heightCm: [120, 220],
  ftpW: [50, 600],
  birthYearMin: 1920,
} as const;

const intIn = ([min, max]: readonly [number, number]) =>
  z
    .number({ error: fieldError('INVALID') })
    .int({ error: 'INVALID' })
    .min(min, { error: 'INVALID' })
    .max(max, { error: 'INVALID' });

/** Год рождения: от 1920 до «текущий год по Минску − 18» (как возраст регистрации, но по году). */
export const VerifiedBirthYear = z
  .number({ error: fieldError('INVALID') })
  .int({ error: 'INVALID' })
  .min(VERIFIED_LIMITS.birthYearMin, { error: 'INVALID', abort: true })
  .refine((year) => year <= Number(minskToday().slice(0, 4)) - MIN_AGE_YEARS, {
    error: 'AGE_BELOW_18',
  });

/** `PUT /v1/profile/verified` — анкета целиком. Пол и год после первой Verified-заявки — только те же. */
export const UpdateVerifiedProfileRequest = z.strictObject({
  gender: z.enum(RIDER_GENDERS, { error: fieldError('REQUIRED') }),
  birthYear: VerifiedBirthYear,
  weightKg: intIn(VERIFIED_LIMITS.weightKg),
  heightCm: intIn(VERIFIED_LIMITS.heightCm),
  ftpW: intIn(VERIFIED_LIMITS.ftpW).nullable(),
  consent: z.literal(true, { error: fieldError('CONSENT_REQUIRED') }),
});
export type UpdateVerifiedProfileRequest = z.infer<typeof UpdateVerifiedProfileRequest>;

/** `GET /v1/profile/verified` и ответ `PUT` (`no-store`, только владельцу). */
export const VerifiedProfileView = z.object({
  profile: z
    .object({
      gender: tolerantEnum(RIDER_GENDERS),
      birthYear: z.number().int(),
      weightKg: z.number().int(),
      heightCm: z.number().int(),
      ftpW: z.number().int().nullable(),
      consentAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
  /** пол и год зафиксированы первой Verified-заявкой — меняет только команда */
  demographicsLocked: z.boolean(),
  /** год из регистрации — только при `profile: null`; иначе `null` */
  suggestedBirthYear: z.number().int().nullable(),
});
export type VerifiedProfileView = z.infer<typeof VerifiedProfileView>;
