import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const ROUTES_QUERY_KEY = ['admin', 'routes'] as const;

/** Пока маршрут обрабатывается — опрос статуса (AGENTS.md §1: статусы — polling). */
export const ROUTE_POLL_MS = 2000;

/** Готовые маршруты платформы — варианты поля «Эталонный коридор» (их десятки: одна страница). */
export const readyRoutesQuery = queryOptions({
  queryKey: [...ROUTES_QUERY_KEY, 'ready'],
  queryFn: () => api.listRoutes({ status: 'ready', limit: 100 }),
});

/** Маршрут с линией показа. */
export const routeQuery = (id: string) =>
  queryOptions({ queryKey: [...ROUTES_QUERY_KEY, 'item', id], queryFn: () => api.getRoute(id) });
