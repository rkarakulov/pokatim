import { z } from 'zod';

import { ActionReason } from '../admin/members.schema.ts';
import { PageQuery, Uuid } from '../common.ts';
import { PageCursor } from '../races/race.schema.ts';
import { ResetRiderNameRequest, RiderNameResetResult } from './profile-admin.schema.ts';
import { ProfileReportReason } from './profile-report.schema.ts';
import { AvatarId } from './rider-avatar.schema.ts';

/*
 * Модерация публичных профилей райдеров в панели «Протокол» (profile-moderation, право `profiles.moderate`): очередь
 * профилей с открытыми жалобами, карточка, сбросы фото/клуба/имени и «Отклонить жалобы». Панель — строгие enum-ы.
 * Имя — только при согласии (Q2), жалобы — без автора.
 */

/** Решение по жалобе на профиль: закрыта сбросом или отклонена. */
export const PROFILE_REPORT_RESOLUTIONS = ['actioned', 'dismissed'] as const;

/** Карточка — не больше 100 последних жалоб. */
export const MODERATION_PROFILE_REPORTS_MAX = 100;
export const RIDER_PROFILE_MODERATION_MAX_LIMIT = 50;

/** `GET /v1/admin/rider-profiles?cursor&limit` → `RiderProfileModerationPage`. */
export const RiderProfileModerationQuery = z.strictObject({
  ...PageQuery.shape,
  cursor: PageCursor.optional(),
  limit: z.coerce.number().int().min(1).max(RIDER_PROFILE_MODERATION_MAX_LIMIT).default(20),
});
export type RiderProfileModerationQuery = z.infer<typeof RiderProfileModerationQuery>;

/**
 * Строка очереди: профиль с открытыми жалобами. `name` — только при согласии (Q2), иначе `null` (панель подписывает
 * `Участник ·<id>`); `topReason` — самая частая открытая причина (ничья — порядок справочника).
 */
export const RiderProfileModerationRow = z.object({
  userId: Uuid,
  name: z.string().nullable(),
  openReportCount: z.number().int().nonnegative(),
  topReason: ProfileReportReason.nullable(),
  lastReportAt: z.iso.datetime().nullable(),
  hasAvatar: z.boolean(),
  hasClub: z.boolean(),
});
export type RiderProfileModerationRow = z.infer<typeof RiderProfileModerationRow>;

export const RiderProfileModerationPage = z.object({
  items: z.array(RiderProfileModerationRow),
  nextCursor: z.string().nullable(),
});
export type RiderProfileModerationPage = z.infer<typeof RiderProfileModerationPage>;

/** Жалоба в карточке — без автора. */
export const RiderProfileModerationReport = z.object({
  id: Uuid,
  reason: ProfileReportReason,
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolution: z.enum(PROFILE_REPORT_RESOLUTIONS).nullable(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type RiderProfileModerationReport = z.infer<typeof RiderProfileModerationReport>;

/**
 * `GET /v1/admin/rider-profiles/:userId`: клуб и фото — всегда (модератор видит то, на что жаловались, и у скрытого
 * профиля, S-2), имя — только при согласии (Q2), до 100 последних жалоб (новые сверху).
 */
export const RiderProfileModerationDetail = z.object({
  userId: Uuid,
  name: z.string().nullable(),
  club: z.string().nullable(),
  avatar: z.object({ id: AvatarId }).nullable(),
  isPublic: z.boolean(),
  openReportCount: z.number().int().nonnegative(),
  lastReportAt: z.iso.datetime().nullable(),
  /** Ревизия жалоб: каждая новая жалоба увеличивает её на 1 — маркер «Отклонить жалобы». */
  reportRevision: z.number().int().nonnegative(),
  reports: z.array(RiderProfileModerationReport).max(MODERATION_PROFILE_REPORTS_MAX),
});
export type RiderProfileModerationDetail = z.infer<typeof RiderProfileModerationDetail>;

/** `POST …/:userId/avatar-reset` и `…/club-reset` — тело как у сброса имени (причина в журнал). */
export const RiderProfileResetRequest = ResetRiderNameRequest;
export type RiderProfileResetRequest = ResetRiderNameRequest;

/** `reset: false` — сбрасывать нечего (идемпотентный успех, без журнала, жалобы открыты). */
export const RiderProfileResetResult = RiderNameResetResult;
export type RiderProfileResetResult = RiderNameResetResult;

/**
 * `POST …/:userId/dismiss-reports` — закрыть открытые жалобы без смены профиля. `reportRevision` — из карточки: пришла
 * новая жалоба — `409 CONFLICT`.
 */
export const DismissRiderProfileReportsRequest = z.strictObject({
  reason: ActionReason,
  reportRevision: z.number().int().nonnegative(),
});
export type DismissRiderProfileReportsRequest = z.infer<typeof DismissRiderProfileReportsRequest>;

/** `dismissed: false` — открытых жалоб уже нет (идемпотентный успех без журнала). */
export const RiderProfileReportsDismissResult = z.object({ dismissed: z.boolean() });
export type RiderProfileReportsDismissResult = z.infer<typeof RiderProfileReportsDismissResult>;
