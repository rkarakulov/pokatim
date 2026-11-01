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
