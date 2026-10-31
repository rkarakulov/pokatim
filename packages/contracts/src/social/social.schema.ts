import { z } from 'zod';

import { tolerantEnum } from '../common.ts';

/*
 * «Свои» (social, ADR-0027, `docs/product/social.md`): общие справочники связей, явки и реакций. Эндпоинты и их DTO —
 * в своих PR (P2–P7); в ответах приложения справочники — `tolerantEnum`, в запросах — строгие. Значения — только в
 * конец (установленные сборки знают прежний состав).
 */

/** Источник связи «Свои» (K1): совместный райд с явкой, приглашение, ручное «В свои». */
export const CONNECTION_SOURCES = ['ride', 'invite', 'manual'] as const;
export const ConnectionSource = z.enum(CONNECTION_SOURCES);
export type ConnectionSource = z.infer<typeof ConnectionSource>;

/** Реакция: «Спасибо за компанию» (K5) и «Респект» (K8). */
export const REACTION_KINDS = ['thanks', 'respect'] as const;
export const ReactionKind = z.enum(REACTION_KINDS);
export type ReactionKind = z.infer<typeof ReactionKind>;

/** Цель реакции: райдер на райде («спасибо»), результат гонки и райдерский маршрут («респект»). */
export const REACTION_TARGET_TYPES = ['ride_rider', 'race_entry', 'route'] as const;
export const ReactionTargetType = z.enum(REACTION_TARGET_TYPES);
export type ReactionTargetType = z.infer<typeof ReactionTargetType>;

/** Как подтверждена явка на райде (K2): «Я был на райде» или заезд по треку. */
export const ATTENDANCE_VIA = ['manual', 'track'] as const;
export const AttendanceVia = z.enum(ATTENDANCE_VIA);
export type AttendanceVia = z.infer<typeof AttendanceVia>;

/** Откуда нажато «Я иду» (K12): карточка райда, секция «Свои», уведомление, профиль райдера. */
export const RIDE_JOIN_SOURCES = ['ride_card', 'social_home', 'notification', 'profile'] as const;
export const RideJoinSource = z.enum(RIDE_JOIN_SOURCES);
export type RideJoinSource = z.infer<typeof RideJoinSource>;

/**
 * `409 SOCIAL_ACTION_BLOCKED.details.reason`: себе нельзя; не участник «Иду»; вне окна явки (до старта или позже 7
 * дней); райд отменён или скрыт; явки нет («спасибо» — только между явившимися).
 */
export const SOCIAL_BLOCK_REASONS = [
  'self',
  'not_participant',
  'attendance_window',
  'ride_unavailable',
  'not_attended',
] as const;
export const SocialBlockReason = z.enum(SOCIAL_BLOCK_REASONS);
export type SocialBlockReason = z.infer<typeof SocialBlockReason>;

/** `409 SOCIAL_ACTION_BLOCKED` — причина отказа (ответ приложению: незнакомая — `'unknown'`). */
export const SocialActionBlockedDetails = z.object({ reason: tolerantEnum(SOCIAL_BLOCK_REASONS) });
export type SocialActionBlockedDetails = z.infer<typeof SocialActionBlockedDetails>;
