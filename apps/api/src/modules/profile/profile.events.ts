import { z } from 'zod';

/**
 * Модератор сбросил имя, фото или клуб профиля (profile-moderation-followups) — уведомление самому райдеру. Маршрут в
 * очередь объявляет подписчик (`notificationsOutboxRoutes`); у `profile` своих маршрутов нет. В payload — только id,
 * код поля и время: без причины модератора и сброшенного значения. `avatarBlockedUntil` — не `null`, только если
 * запрет загрузки фото включён **этим** сбросом.
 */
export const PROFILE_FIELD_RESET = 'profile.field-reset';
export const PROFILE_RESET_FIELDS = ['name', 'avatar', 'club'] as const;
export type ProfileResetField = (typeof PROFILE_RESET_FIELDS)[number];
export const ProfileFieldReset = z.strictObject({
  userId: z.uuid(),
  field: z.enum(PROFILE_RESET_FIELDS),
  resetAt: z.iso.datetime(),
  avatarBlockedUntil: z.iso.datetime().nullable(),
});
export type ProfileFieldReset = z.infer<typeof ProfileFieldReset>;
