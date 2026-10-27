import type {
  CatalogRouteDetail,
  CatalogRoutePage,
  RacePage,
  RouteMapGeometry,
} from '@pokatim/contracts';
import { queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { RouteFilters } from './filters';

/**
 * Каталог маршрутов (routes-01) — публичное чтение без `withAccessToken`; сервер отдаёт `public, max-age=60` — чаще
 * перезапрашивать незачем. 404 не повторяется (`shouldRetry`).
 */
const PUBLIC_STALE_MS = 60_000;
const PAGE_LIMIT = 20;
/** Гонок маршрута на первой странице карточки (RC-12). */
export const ROUTE_RACES_LIMIT = 10;

const nextCursor = (page: CatalogRoutePage | RacePage) => page.nextCursor ?? undefined;

/**
 * Лента вкладки: ключ `['routes','list',{ city, distance, surface, limit },'pages']` — форма `InfiniteData` не
 * совпадает с ключом Главной (`['routes','list',{ limit: 1 }]`), префикс общий. Смена фильтра — новый ключ:
 * скелетон на месте данных (без `keepPreviousData`).
 */
export function useRouteFeed(filters: RouteFilters) {
  const params = {
    city: filters.city,
    distance: filters.distance,
    surface: filters.surface,
    limit: PAGE_LIMIT,
  };
  const feed = useInfiniteQuery({
    queryKey: ['routes', 'list', params, 'pages'],
    queryFn: ({ pageParam }) =>
      api.listCatalogRoutes({
        city: [...filters.city],
        distance: [...filters.distance],
        surface: [...filters.surface],
        limit: PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: PUBLIC_STALE_MS,
  });

  // идёт обновление (pull-to-refresh, фокус) — не догружаем: fetchNextPage отменил бы refetch (как у гонок)
  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) {
      void feed.fetchNextPage({ cancelRefetch: false });
    }
  };

  return { feed, loadMore };
}

/** Чипы «Город»: коды городов опубликованных маршрутов (незнакомые отброшены схемой). */
export function useRouteCities() {
  return useQuery({
    queryKey: ['routes', 'cities'],
    queryFn: () => api.listCatalogRouteCities(),
    staleTime: PUBLIC_STALE_MS,
  });
}

/** Карточка маршрута: посев SSR (`initialData`) — только web; 404 — `ApiHttpError` со статусом. */
export function useCatalogRoute(
  id: string,
  seed: CatalogRouteDetail | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['routes', 'detail', id],
    queryFn: () => api.getCatalogRoute(id),
    initialData: seed,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/**
 * Геометрия для карты (`RouteLineMap`) — только клиент; готовый маршрут неизменен по геометрии (pull-to-refresh её не
 * трогает).
 */
export const catalogRouteMapOptions = (id: string) =>
  queryOptions<RouteMapGeometry>({
    queryKey: ['routes', 'map', id],
    queryFn: () => api.getCatalogRouteMap(id),
    staleTime: PUBLIC_STALE_MS,
  });

/** «Гонки на маршруте» (RC-12): новые сверху, первая страница — 10, «Показать ещё»; только клиент. */
export function useCatalogRouteRaces(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['routes', 'races', id, 'pages'],
    queryFn: ({ pageParam }) =>
      api.listCatalogRouteRaces(id, {
        limit: ROUTE_RACES_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}
