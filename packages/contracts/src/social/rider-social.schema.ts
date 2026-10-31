import { z } from 'zod';

import { tolerantEnum } from '../common.ts';
import { AvatarId, RiderPublicId } from '../profile/rider-avatar.schema.ts';
import { RideCard } from '../rides/ride.schema.ts';
import { CONNECTION_SOURCES } from './social.schema.ts';

/*
 * «Свои» на профиле райдера (P3, K6, ADR-0027 п. 3): данные вошедшего зрителя — отдельные эндпоинты `social` под
 * `AuthGuard`, `no-store`; публичный `GET /v1/riders/:publicId` не меняется.
 */

/** «Вместе ехали» относительно зрителя (K6): 0 и null — не ехали. */
export const RiderTogether = z.object({
  rideCount: z.number().int(),
  lastRideAt: z.iso.datetime().nullable(),
});
export type RiderTogether = z.infer<typeof RiderTogether>;

/** `GET /v1/riders/:publicId/social` и ответ `PUT …/social/connection` (вошедший зритель, no-store). */
export const RiderSocial = z.object({
  self: z.boolean(),
  /** зритель держит связь viewer → rider (не убрана) */
  connected: z.boolean(),
  together: RiderTogether,
  /** ближайший будущий райд райдера — только если зритель у него в «своих»; иначе null */
  going: RideCard.nullable().default(null),
});
export type RiderSocial = z.infer<typeof RiderSocial>;

/** `PUT /v1/riders/:publicId/social/connection` — «В свои» (true) / «Убрать из своих» (false); лишние ключи — 400. */
export const SetRiderConnectionRequest = z.strictObject({ connected: z.boolean() });
export type SetRiderConnectionRequest = z.infer<typeof SetRiderConnectionRequest>;

/** Строка «Свои» (K6): только публичные профили, без userId. */
export const SocialConnectionRow = z.object({
  publicId: RiderPublicId,
  name: z.string(),
  avatar: z.object({ id: AvatarId }).nullable(),
  rideCount: z.number().int(),
  lastRideAt: z.iso.datetime().nullable(),
  sources: z.array(tolerantEnum(CONNECTION_SOURCES)),
});
export type SocialConnectionRow = z.infer<typeof SocialConnectionRow>;

/**
 * `GET /v1/social/connections`: `lastRideAt ↓` (без совместных райдов — в конце), затем недавно изменённые; `count =
 * items.length` (этап 0 без пагинации) — «Свои · N».
 */
export const SocialConnections = z.object({
  items: z.array(SocialConnectionRow),
  count: z.number().int(),
});
export type SocialConnections = z.infer<typeof SocialConnections>;
