import type { PanelRouteSummary } from '@pokatim/contracts';
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const ROUTES_QUERY_KEY = ['admin', 'routes'] as const;

/** Пока маршрут обрабатывается — опрос статуса (AGENTS.md §1: статусы — polling). */
export const ROUTE_POLL_MS = 2000;
/** Дольше — опрос прекращается, панель предлагает проверить позже (сервер вернёт зависший маршрут в обработку). */
export const ROUTE_POLL_MAX_MS = 5 * 60 * 1000;
/** Предел страниц списка готовых маршрутов (по 100) — защита от бесконечного цикла курсора. */
const READY_ROUTES_MAX_PAGES = 50;

/** Готовые маршруты платформы — варианты поля «Эталонный коридор»: все страницы списка по курсору. */
export const readyRoutesQuery = queryOptions({
  queryKey: [...ROUTES_QUERY_KEY, 'ready'],
  queryFn: async () => {
    const items: PanelRouteSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < READY_ROUTES_MAX_PAGES; page += 1) {
      const result = await api.listRoutes({
        status: 'ready',
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      items.push(...result.items);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return { items };
  },
});

/** Маршрут с линией показа. */
export const routeQuery = (id: string) =>
  queryOptions({ queryKey: [...ROUTES_QUERY_KEY, 'item', id], queryFn: () => api.getRoute(id) });
