import { z } from 'zod';

import { ActionReason } from '../admin/members.schema.ts';
import { RIDER_GENDERS } from '../results/results.schema.ts';
import { ProfileReportReason } from './profile-report.schema.ts';
import { VerifiedBirthYear } from './verified-profile.schema.ts';

/**
 * `POST /v1/admin/profiles/:userId/name-reset` (`profiles.moderate`, profile-02): сброс публичного имени райдера
 * модератором. Причина — код справочника причин жалоб на профиль (profile-moderation-d11): код — в журнал
 * (`details.resetReason`), текст `comment` — только у `other` (обязателен), у прочих — `INVALID` (панель — единственный
 * клиент, строгий контракт). Само имя в журнал не пишется (ПДн).
 */
export const ResetRiderNameRequest = z
  .strictObject({ reason: ProfileReportReason, comment: ActionReason.optional() })
  .superRefine((body, ctx) => {
    if (body.reason === 'other' && body.comment === undefined)
      ctx.addIssue({ code: 'custom', message: 'REQUIRED', path: ['comment'] });
    if (body.reason !== 'other' && body.comment !== undefined)
      ctx.addIssue({ code: 'custom', message: 'INVALID', path: ['comment'] });
  });
export type ResetRiderNameRequest = z.infer<typeof ResetRiderNameRequest>;

/** `reset: false` — имени уже не было (идемпотентный успех, записи журнала нет; D2). */
export const RiderNameResetResult = z.object({ reset: z.boolean() });
export type RiderNameResetResult = z.infer<typeof RiderNameResetResult>;

/**
 * `GET /v1/admin/profiles/:userId/verified-demographics` (`profiles.verified_edit`, race-results-07): пол и год анкеты
 * Verified для диалога правки admin. Вес, рост, FTP — не выдаются.
 */
export const PanelVerifiedDemographics = z.object({
  gender: z.enum(RIDER_GENDERS),
  birthYear: z.number().int(),
  demographicsLocked: z.boolean(),
});
export type PanelVerifiedDemographics = z.infer<typeof PanelVerifiedDemographics>;

/**
 * `PATCH /v1/admin/profiles/:userId/verified-demographics`: хотя бы одно поле и причина (в журнал — только имена
 * изменённых полей). Существующие заявки не меняются.
 */
export const UpdateVerifiedDemographicsRequest = z
  .strictObject({
    gender: z.enum(RIDER_GENDERS).optional(),
    birthYear: VerifiedBirthYear.optional(),
    reason: ActionReason,
  })
  .refine((body) => body.gender !== undefined || body.birthYear !== undefined, {
    error: 'REQUIRED',
  });
export type UpdateVerifiedDemographicsRequest = z.infer<typeof UpdateVerifiedDemographicsRequest>;

/** `changed: false` — значения уже такие (идемпотентный успех, без записи журнала). */
export const VerifiedDemographicsResult = PanelVerifiedDemographics.extend({
  changed: z.boolean(),
});
export type VerifiedDemographicsResult = z.infer<typeof VerifiedDemographicsResult>;
