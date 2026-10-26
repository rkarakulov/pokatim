import { z } from 'zod';

import { QUEUE } from '../../queues';

/** Маршрут принят (исходник в `route_sources`) — разобрать в worker. В payload — только id маршрута. */
export const ROUTE_RECEIVED = 'routes.route-received';
export const RouteReceived = z.object({ routeId: z.uuid() });
export type RouteReceived = z.infer<typeof RouteReceived>;

/** Маршруты событий routes для публикатора outbox (подключает worker.module.ts). */
export const routesOutboxRoutes = {
  [ROUTE_RECEIVED]: QUEUE.routeProcessing,
} as const;
