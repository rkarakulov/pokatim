import { z } from 'zod';

import { QUEUE } from '../../queues';

/** Маршрут принят (исходник в `route_sources`) — разобрать в worker. В payload — только id маршрута. */
export const ROUTE_RECEIVED = 'routes.route-received';
export const RouteReceived = z.object({ routeId: z.uuid() });
export type RouteReceived = z.infer<typeof RouteReceived>;

/**
 * Решение модератора по заявке маршрута райдера в каталог (routes-06, A6). Маршрут в очередь объявляет подписчик —
 * `notificationsOutboxRoutes` (уведомление автору); хвост давних решений отсекает intake (> 72 ч). В payload — только
 * id и решение: без названия, причин и имени.
 */
export const ROUTE_PUBLICATION_DECIDED = 'routes.publication-decided';
export const RoutePublicationDecided = z.strictObject({
  routeId: z.uuid(),
  authorUserId: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
  decidedAt: z.iso.datetime(),
});
export type RoutePublicationDecided = z.infer<typeof RoutePublicationDecided>;

/** Маршруты событий routes для публикатора outbox (подключает worker.module.ts). */
export const routesOutboxRoutes = {
  [ROUTE_RECEIVED]: QUEUE.routeProcessing,
} as const;
