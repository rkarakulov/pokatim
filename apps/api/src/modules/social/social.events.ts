import { RIDE_MAX_PARTICIPANTS } from '@pokatim/contracts';
import { z } from 'zod';

import { QUEUE } from '../../queues';
import { IDENTITY_ACCOUNT_CONFIRMED } from '../identity';
import { TRACK_ACTIVITY_READY } from '../tracks';

/**
 * Подписка «Свои» на события других модулей (ADR-0027 п. 5): маршрут объявляет подписчик. Новые типы — в конец.
 * `identity.account-confirmed` — связь по приглашению (P6); `tracks.activity-ready` — автоявка (P5, fan-out вместе с
 * `results-intake`).
 */
export const socialOutboxRoutes = {
  [IDENTITY_ACCOUNT_CONFIRMED]: QUEUE.socialIntake,
  // автоявка (P5)
  [TRACK_ACTIVITY_READY]: QUEUE.socialIntake,
} as const;

/**
 * События «Свои» для уведомлений K10 (P7, ADR-0027 п. 6): пишутся в транзакции действия, маршрут объявляет подписчик
 * (`notificationsOutboxRoutes`). Payload — только id: ни имён, ни названий, ни кодов приглашений; состояние «сейчас»
 * подписчик читает портом `SOCIAL_NOTICES`.
 */
/** Новая реакция «Спасибо» или «Респект» (`SocialReactionsService.insert`). */
export const SOCIAL_REACTION_CREATED = 'social.reaction-created';
export const SocialReactionCreated = z.object({ reactionId: z.uuid() });
export type SocialReactionCreated = z.infer<typeof SocialReactionCreated>;

/** Ручное «В свои», о котором можно уведомить (K11: не чаще раза в `manualRenotifyMs` на пару). */
export const SOCIAL_CONNECTION_ADDED = 'social.connection-added';
export const SocialConnectionAdded = z.object({ ownerId: z.uuid(), otherId: z.uuid() });
export type SocialConnectionAdded = z.infer<typeof SocialConnectionAdded>;

/** По коду приглашения зарегистрировались (`linkInvite`, впервые для пары). */
export const SOCIAL_INVITE_REGISTERED = 'social.invite-registered';
export const SocialInviteRegistered = z.object({ inviterId: z.uuid(), inviteeId: z.uuid() });
export type SocialInviteRegistered = z.infer<typeof SocialInviteRegistered>;

/** «Как прошёл райд?» (P5 → P7): адресаты отобраны в транзакции захвата регламента. */
export const SOCIAL_RIDE_ASK_DUE = 'social.ride-ask-due';
export const SocialRideAskDue = z.object({
  rideId: z.uuid(),
  userIds: z.array(z.uuid()).min(1).max(RIDE_MAX_PARTICIPANTS),
});
export type SocialRideAskDue = z.infer<typeof SocialRideAskDue>;
