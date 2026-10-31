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

/**
 * Явка зрителя-участника; флаги — `attendanceCheck` сервера (окно, роль, фаза). `attended` — «Ехали N», только при
 * явке. Незнакомое `state` (`'unknown'`) — клиент показывает только список участников.
 */
export const RideAttendance = z.object({
  state: tolerantEnum(RIDE_ATTENDANCE_STATES),
  canMark: z.boolean().default(false),
  canDecline: z.boolean().default(false),
  attended: RideRiderGroup.nullable().default(null),
});
export type RideAttendance = z.infer<typeof RideAttendance>;

/** `GET /v1/rides/:id/participants` и ответ «Я был» / «Меня не было». Не участнику — `attendance: null`. */
export const RideParticipants = RideRiderGroup.extend({
  attendance: RideAttendance.nullable().default(null),
});
export type RideParticipants = z.infer<typeof RideParticipants>;
