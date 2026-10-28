import { z } from 'zod';

import { QUEUE } from '../../queues';

/** Заезд по маршруту поставлен на проверку (новая ревизия). jobId задачи = id события. */
export const ROUTE_RIDES_CHECK_REQUESTED = 'route-rides.check-requested';
export const RouteRidesCheckRequested = z.object({
  rideId: z.uuid(),
  checkRevision: z.number().int().positive(),
});
export type RouteRidesCheckRequested = z.infer<typeof RouteRidesCheckRequested>;

/**
 * Маршруты событий `route-rides` (подключает worker.module.ts). Подписки на `tracks.*` нет (8.1 RC-1: тип события —
 * одна очередь, `results` уже слушает `tracks.activity-ready/-removed`): удалённая активность скрывается фильтром на
 * чтении.
 */
export const routeRidesOutboxRoutes = {
  [ROUTE_RIDES_CHECK_REQUESTED]: QUEUE.routeRideCheck,
} as const;
