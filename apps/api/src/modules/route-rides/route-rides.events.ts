import { z } from 'zod';

import { QUEUE } from '../../queues';
import { TRACK_ACTIVITY_GROUP_CREATED } from '../tracks';

/** Заезд по маршруту поставлен на проверку (новая ревизия). jobId задачи = id события. */
export const ROUTE_RIDES_CHECK_REQUESTED = 'route-rides.check-requested';
export const RouteRidesCheckRequested = z.object({
  rideId: z.uuid(),
  checkRevision: z.number().int().positive(),
});
export type RouteRidesCheckRequested = z.infer<typeof RouteRidesCheckRequested>;

/**
 * Маршруты событий `route-rides` (объединяет `src/outbox-routes.ts`, `mergeOutboxRoutes` — fan-out). Автопроверка
 * подписана на тип владельца `tracks.activity-group-created` (route-rides-03, 8.1 AC-1/AC-2): «новая группа дублей»
 * решается только в транзакции записи активности, подписчик `tracks.activity-ready` её не восстановит. Удалённая
 * активность скрывается фильтром на чтении.
 */
export const routeRidesOutboxRoutes = {
  [ROUTE_RIDES_CHECK_REQUESTED]: QUEUE.routeRideCheck,
  [TRACK_ACTIVITY_GROUP_CREATED]: QUEUE.routeRideAuto,
} as const;
