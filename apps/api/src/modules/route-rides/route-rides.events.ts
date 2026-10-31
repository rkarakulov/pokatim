import { z } from 'zod';

import { QUEUE } from '../../queues';
import { TRACK_ACTIVITY_GROUP_CREATED } from '../tracks';
import { ROUTE_RIDE_AUTO_POLICY } from './route-rides.policy';

/** Заезд по маршруту поставлен на проверку (новая ревизия). jobId задачи = id события. */
export const ROUTE_RIDES_CHECK_REQUESTED = 'route-rides.check-requested';
export const RouteRidesCheckRequested = z.object({
  rideId: z.uuid(),
  checkRevision: z.number().int().positive(),
});
export type RouteRidesCheckRequested = z.infer<typeof RouteRidesCheckRequested>;

/**
 * Данные задачи `route-ride-auto` (route-rides-03, ревью pass 2): `plan` — маршруты, зафиксированные первой попыткой
 * (`job.updateData` до сверок); ретрай проверяет только их — план не расширяется при смене входов между попытками.
 */
export const RouteRideAutoJobData = z.object({
  outboxEventId: z.uuid(),
  plan: z.array(z.uuid()).max(ROUTE_RIDE_AUTO_POLICY.maxRoutes).optional(),
});
export type RouteRideAutoJobData = z.infer<typeof RouteRideAutoJobData>;

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
