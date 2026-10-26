import type { PanelRouteSummary } from '@pokatim/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const ROUTES_QUERY_KEY = ['admin', 'routes'] as const;

/** Пока маршрут обрабатывается — опрос статуса (AGENTS.md §1: статусы — polling). */
export const ROUTE_POLL_MS = 2000;
/** Дольше — опрос прекращается, панель предлагает проверить позже (сервер вернёт зависший маршрут в обработку). */
export const ROUTE_POLL_MAX_MS = 5 * 60 * 1000;
/**
 * Готовые маршруты платформы — варианты поля «Эталонный коридор»: все страницы списка по курсору, без скрытого предела.
 * Повтор курсора (ошибка сервера) — ошибка запроса, а не неполный список под видом полного.
 */
export const readyRoutesQuery = queryOptions({
  queryKey: [...ROUTES_QUERY_KEY, 'ready'],
  queryFn: async () => {
    const items: PanelRouteSummary[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const result = await api.listRoutes({
        status: 'ready',
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      items.push(...result.items);
      if (!result.nextCursor) return { items };
      if (seen.has(result.nextCursor)) throw new Error('routes list: repeated cursor');
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }
  },
});

/** Маршрут с линией показа. */
export const routeQuery = (id: string) =>
  queryOptions({ queryKey: [...ROUTES_QUERY_KEY, 'item', id], queryFn: () => api.getRoute(id) });

/** Страница экрана «Маршруты» (готовые платформы + свои необработанные, новые сверху). */
export const ROUTES_PAGE_SIZE = 50;

/** Экран «Маршруты»: страницы списка по курсору (`useInfiniteQuery`), «Показать ещё». */
export const routesPagesQuery = infiniteQueryOptions({
  queryKey: [...ROUTES_QUERY_KEY, 'list'],
  queryFn: ({ pageParam }) =>
    api.listRoutes({ limit: ROUTES_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});
