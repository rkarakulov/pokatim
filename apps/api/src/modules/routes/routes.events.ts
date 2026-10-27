import { z } from 'zod';

import { QUEUE } from '../../queues';

/** Маршрут принят (исходник в `route_sources`) — разобрать в worker. В payload — только id маршрута. */
export const ROUTE_RECEIVED = 'routes.route-received';
export const RouteReceived = z.object({ routeId: z.uuid() });
export type RouteReceived = z.infer<typeof RouteReceived>;

/**
 * Решение модератора по заявке маршрута райдера в каталог (routes-06, A6) — для будущего модуля уведомлений. **Без
 * маршрута** в `routesOutboxRoutes` (8.1 RC-3, как `results.protocol-published`): издатель outbox берёт только типы из
 * маршрутов, событие ждёт `publishedAt: null`. Перед подключением потребителя — правило «хвост» (`pokatim-backend.md`):
 * `decidedAt` позволяет пропустить давние решения. В payload — только id и решение: без названия, причин и имени.
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
