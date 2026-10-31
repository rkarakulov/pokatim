import { QUEUE } from '../../queues';
import { IDENTITY_ACCOUNT_CONFIRMED } from '../identity';

/**
 * Подписка «Свои» на события других модулей (ADR-0027 п. 5): маршрут объявляет подписчик. Новые типы — в конец.
 * `identity.account-confirmed` — связь по приглашению (P6).
 */
export const socialOutboxRoutes = {
  [IDENTITY_ACCOUNT_CONFIRMED]: QUEUE.socialIntake,
} as const;
