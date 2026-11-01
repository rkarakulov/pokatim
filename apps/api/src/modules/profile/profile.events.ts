import { PROFILE_REPORT_RESOLUTIONS } from '@pokatim/contracts';
import { z } from 'zod';

/**
 * Модератор сбросил имя, фото или клуб профиля (profile-moderation-followups) — уведомление самому райдеру. Маршрут в
 * очередь объявляет подписчик (`notificationsOutboxRoutes`); у `profile` своих маршрутов нет. В payload — только id,
 * код поля и время: без причины модератора и сброшенного значения. `avatarBlockedUntil` — не `null`, только если
 * запрет загрузки фото включён **этим** сбросом. `seq` — ревизия сбросов профиля (`resetSeq`, `$inc` условной записью
 * сброса, ревью pass 2): порядок уведомлений по полю — по ней, не по `resetAt` (время берётся до транзакции и не
 * монотонно между конкурирующими сбросами). Обязательна: событие без неё — `invalid_payload` (внутреннее, в проде
 * старых нет; смешивать ревизию со временем в одном `collapseSeq` нельзя).
 */
export const PROFILE_FIELD_RESET = 'profile.field-reset';
export const PROFILE_RESET_FIELDS = ['name', 'avatar', 'club'] as const;
export type ProfileResetField = (typeof PROFILE_RESET_FIELDS)[number];
export const ProfileFieldReset = z.strictObject({
  userId: z.uuid(),
  field: z.enum(PROFILE_RESET_FIELDS),
  resetAt: z.iso.datetime(),
  seq: z.number().int().positive(),
  avatarBlockedUntil: z.iso.datetime().nullable(),
});
export type ProfileFieldReset = z.infer<typeof ProfileFieldReset>;

/**
 * Модератор закрыл открытые жалобы на профиль (profile-moderation-d11): сброс имени, фото или клуба (`actioned`) или
 * «Отклонить жалобы» (`dismissed`) — уведомление авторам закрытых жалоб. Пишется в транзакции действия, только если
 * закрыта хотя бы одна жалоба. Payload самодостаточен (порта у `profile` нет, RC-F3): id профиля, решение и id
 * авторов без дублей; без имени, клуба, причины модератора и id жалоб. Живость авторов проверяет запись
 * (`liveUserIds`).
 */
export const PROFILE_REPORTS_RESOLVED = 'profile.reports-resolved';
export const ProfileReportsResolved = z.strictObject({
  targetUserId: z.uuid(),
  resolution: z.enum(PROFILE_REPORT_RESOLUTIONS),
  reporterUserIds: z.array(z.uuid()).min(1),
});
export type ProfileReportsResolved = z.infer<typeof ProfileReportsResolved>;
