import { mergeOutboxRoutes, type OutboxRoutes } from '@rkarakulov/api-kit/core';

import { accountOutboxRoutes } from './modules/account';
import { devicesOutboxRoutes } from './modules/devices';
import { identityOutboxRoutes } from './modules/identity';
import { notificationsOutboxRoutes } from './modules/notifications';
import { panelOutboxRoutes } from './modules/panel';
import { resultsOutboxRoutes } from './modules/results';
import { routeRidesOutboxRoutes } from './modules/route-rides';
import { routesOutboxRoutes } from './modules/routes';
import { ticketsOutboxRoutes } from './modules/tickets';
import { tracksOutboxRoutes } from './modules/tracks';

/**
 * Маршруты outbox подписчиков (тип события → очередь), каждый объявляет свой модуль. Новый подписчик — в конец списка.
 */
export const subscriberOutboxRoutes: readonly OutboxRoutes[] = [
  identityOutboxRoutes,
  tracksOutboxRoutes,
  devicesOutboxRoutes,
  routesOutboxRoutes,
  resultsOutboxRoutes,
  routeRidesOutboxRoutes,
  accountOutboxRoutes,
  ticketsOutboxRoutes,
  panelOutboxRoutes,
  // подписчик чужих типов (results, disputes, rides, routes, tickets, profile, achievements) — ADR-0017
  notificationsOutboxRoutes,
];

/**
 * Composition root outbox (`worker.module.ts`): `mergeOutboxRoutes` — тип у нескольких подписчиков получает задачу в
 * каждой их очереди (fan-out, api-kit ≥ 0.6.0, ADR-0017 п. 5); spread оставил бы только последнего подписчика типа.
 */
export const buildOutboxRoutes = (subscribers: readonly OutboxRoutes[]): OutboxRoutes =>
  mergeOutboxRoutes(...subscribers);

export const workerOutboxRoutes: OutboxRoutes = buildOutboxRoutes(subscriberOutboxRoutes);
