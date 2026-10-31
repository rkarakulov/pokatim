import { z } from 'zod';

import { QUEUE } from '../../queues';
import { TRACK_ACTIVITY_REMOVED } from '../tracks';

/** Заезд по маршруту поставлен на проверку (новая ревизия). jobId задачи = id события. */
export const ROUTE_RIDES_CHECK_REQUESTED = 'route-rides.check-requested';
export const RouteRidesCheckRequested = z.object({
  rideId: z.uuid(),
  checkRevision: z.number().int().positive(),
});
export type RouteRidesCheckRequested = z.infer<typeof RouteRidesCheckRequested>;

/**
 * Маршруты событий `route-rides` (подключает `src/outbox-routes.ts`). `tracks.activity-removed` — fan-out вместе с
 * `results-intake`: заезды удалённой активности удаляются сразу; фильтр на чтении и уборка сирот в транзакции нового
 * заезда остаются страховкой (RC-1, гонка с POST и окно до обработки события).
 */
export const routeRidesOutboxRoutes = {
  [ROUTE_RIDES_CHECK_REQUESTED]: QUEUE.routeRideCheck,
  [TRACK_ACTIVITY_REMOVED]: QUEUE.routeRidesIntake,
} as const;
