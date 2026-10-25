import { z } from 'zod';

import { RIDE_REASONS, type RideReason } from './onboarding.schema.ts';

const isRideReason = (code: string): code is RideReason =>
  (RIDE_REASONS as readonly string[]).includes(code);

/**
 * `GET /v1/profile` (под `AuthGuard`, `no-store`) — профиль своего пользователя: ответы опроса для порядка
 * разделов Главной. Неизвестные коды новых версий отбрасываются, а не ломают разбор старыми сборками (R5 блока 02);
 * запрос `PUT …/survey` остаётся строгим.
 */
export const ProfileView = z.object({
  rideReasons: z.array(z.string()).transform((codes) => codes.filter(isRideReason)),
});
export type ProfileView = z.output<typeof ProfileView>;
