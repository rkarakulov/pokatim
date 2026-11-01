import { z } from 'zod';

import { tolerantEnum } from '../common.ts';
import { AvatarId, RiderPublicId } from '../profile/rider-avatar.schema.ts';

/** Явка зрителя на райде (K5): нет отметки, был, «Меня не было». Только в конец. */
export const RIDE_ATTENDANCE_STATES = ['none', 'attended', 'declined'] as const;

/** Публичный участник (K3, K4): имя, ссылка на профиль и фото — только при имени и согласии; без `userId`. */
export const RideRiderRow = z.object({
  name: z.string(),
  publicId: RiderPublicId.nullable().default(null),
  avatar: z.object({ id: AvatarId }).nullable().default(null),
});
export type RideRiderRow = z.infer<typeof RideRiderRow>;

/** Публичные строки (порядок сервера, организатор первым) и число непубличных («и ещё N»). */
export const RideRiderGroup = z.object({
  riders: z.array(RideRiderRow),
  hiddenCount: z.number().int().min(0),
});
export type RideRiderGroup = z.infer<typeof RideRiderGroup>;

/** Строка «Ехали N» (P4, K5, RC-P4-7): `self` — строка зрителя (без «Спасибо»), `thanked` — зритель уже сказал спасибо. */
export const RideAttendedRow = RideRiderRow.extend({
  self: z.boolean().default(false),
  thanked: z.boolean().default(false),
});
export type RideAttendedRow = z.infer<typeof RideAttendedRow>;

/** «Ехали N»: публичные явившиеся строками с флагами зрителя, остальные — числом. */
export const RideAttendedGroup = z.object({
  riders: z.array(RideAttendedRow),
  hiddenCount: z.number().int().min(0),
});
export type RideAttendedGroup = z.infer<typeof RideAttendedGroup>;

/**
 * Явка зрителя-участника; флаги — `attendanceCheck` сервера (окно, роль, фаза). `attended` — «Ехали N», только при
 * явке. `allThanked` — зритель поблагодарил всех явившихся «Ехали N», кроме себя (скрытых тоже; нет других — `true`,
 * P4). Незнакомое `state` (`'unknown'`) — клиент показывает только список участников.
 */
export const RideAttendance = z.object({
  state: tolerantEnum(RIDE_ATTENDANCE_STATES),
  canMark: z.boolean().default(false),
  canDecline: z.boolean().default(false),
  attended: RideAttendedGroup.nullable().default(null),
  allThanked: z.boolean().default(false),
});
export type RideAttendance = z.infer<typeof RideAttendance>;

/** `GET /v1/rides/:id/participants` и ответ «Я был» / «Меня не было». Не участнику — `attendance: null`. */
export const RideParticipants = RideRiderGroup.extend({
  attendance: RideAttendance.nullable().default(null),
});
export type RideParticipants = z.infer<typeof RideParticipants>;
