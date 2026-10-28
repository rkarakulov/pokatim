import { z } from 'zod';

import { fieldError, MULTI_LINE, optionalText, tolerantEnum } from '../common.ts';

/*
 * Жалоба на публичный профиль райдера (profile-moderation): вошедший райдер жалуется на чужой публичный профиль; одна
 * открытая жалоба на профиль от пользователя, после решения модератора — снова можно. Очередь и решения — в панели
 * (`profile-moderation.schema.ts`).
 */

/** Причины жалобы; подписи — `domain.profileReportReason.*`. Только в конец. */
export const PROFILE_REPORT_REASONS = [
  'photo',
  'club',
  'name',
  'impersonation',
  'spam',
  'other',
] as const;
export const ProfileReportReason = z.enum(PROFILE_REPORT_REASONS, {
  error: fieldError('REQUIRED'),
});
export type ProfileReportReason = z.infer<typeof ProfileReportReason>;

export const PROFILE_REPORT_COMMENT_MAX = 500;

/**
 * `POST /v1/riders/:publicId/reports` → 200 `RiderProfileViewer` (`reported: true`). Повтор при открытой жалобе —
 * идемпотентный успех (комментарий второй попытки не сохраняется). Пустой комментарий — `null`.
 */
export const CreateProfileReportRequest = z.strictObject({
  reason: ProfileReportReason,
  comment: optionalText(PROFILE_REPORT_COMMENT_MAX, MULTI_LINE).optional(),
});
export type CreateProfileReportRequest = z.infer<typeof CreateProfileReportRequest>;

/**
 * `GET /v1/riders/:publicId/me` — состояние вошедшего зрителя публичного профиля: есть ли открытая жалоба этого
 * пользователя (`reported`) и можно ли пожаловаться (профиль чужой и открытой жалобы нет). Нестрогий: будущие поля —
 * с `.default`.
 */
export const RiderProfileViewer = z.object({ canReport: z.boolean(), reported: z.boolean() });
export type RiderProfileViewer = z.infer<typeof RiderProfileViewer>;

/** Причина `409 PROFILE_INVALID_STATE` (`details`): жалоба на свой профиль. Только в конец. */
export const PROFILE_STATE_REASONS = ['own_profile'] as const;
export const ProfileStateDetails = z.object({ reason: tolerantEnum(PROFILE_STATE_REASONS) });
export type ProfileStateDetails = z.infer<typeof ProfileStateDetails>;
