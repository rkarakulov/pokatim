import { apiErrorOf } from '@pokatim/api-client';
import type { MyRoute, MyRoutePage, RouteMapGeometry } from '@pokatim/contracts';
import {
  type InfiniteData,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

/**
 * Мои маршруты (routes-02): все запросы — с входом (`withAccessToken`), префикс `['routes','mine']` не пересекается с
 * каталогом; при выходе кеш стирается целиком (`queryClient.clear()` корневого layout).
 */
export const myRoutesKeys = {
  all: ['routes', 'mine'] as const,
  list: ['routes', 'mine', 'list', 'pages'] as const,
  detail: (id: string) => ['routes', 'mine', 'detail', id] as const,
  map: (id: string) => ['routes', 'mine', 'map', id] as const,
};

/** Опрос статуса «Обрабатывается» — как у загрузок заездов (polling, не сокеты). */
export const MY_ROUTE_POLL_MS = 3000;
export const MY_ROUTES_PAGE_LIMIT = 20;

const isProcessing = (route: MyRoute) => route.status === 'processing';

/** Свои маршруты, новые сверху; пока в загруженных страницах есть «Обрабатывается» — опрос раз в 3 с. */
export function useMyRoutes() {
  const feed = useInfiniteQuery({
    queryKey: myRoutesKeys.list,
    queryFn: ({ pageParam }) =>
      withAccessToken((token) =>
        api.listMyRoutes(token, {
          limit: MY_ROUTES_PAGE_LIMIT,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page: MyRoutePage) => page.nextCursor ?? undefined,
    staleTime: DEFAULT_STALE_MS,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some(isProcessing))
        ? MY_ROUTE_POLL_MS
        : false,
  });

  // идёт обновление (pull-to-refresh, опрос) — не догружаем: fetchNextPage отменил бы refetch
  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) {
      void feed.fetchNextPage({ cancelRefetch: false });
    }
  };
  return { feed, loadMore };
}

/** Карточка своего маршрута: опрос, пока «Обрабатывается»; стал готовым — список обновляется. */
export function useMyRoute(id: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const route = useQuery({
    queryKey: myRoutesKeys.detail(id),
    queryFn: () => withAccessToken((token) => api.getMyRoute(token, id)),
    staleTime: DEFAULT_STALE_MS,
    // удалён (404) — опрос прекращается, даже если в кеше остался «Обрабатывается»
    refetchInterval: (query) =>
      query.state.data &&
      isProcessing(query.state.data) &&
      apiErrorOf(query.state.error)?.code !== 'NOT_FOUND'
        ? MY_ROUTE_POLL_MS
        : false,
    enabled,
  });
  // список обновляется только при переходе из «Обрабатывается» (открытие готовой карточки его не трогает)
  const status = route.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === 'processing' && status !== undefined && status !== 'processing') {
      void queryClient.invalidateQueries({ queryKey: myRoutesKeys.list });
    }
    previous.current = status;
  }, [status, queryClient]);
  return route;
}

/** Геометрия своего готового маршрута для `RouteLineMap`: неизменна — `staleTime: Infinity`. */
export const myRouteMapOptions = (id: string) =>
  queryOptions<RouteMapGeometry>({
    queryKey: myRoutesKeys.map(id),
    queryFn: () => withAccessToken((token) => api.getMyRouteMap(token, id)),
    staleTime: Infinity,
  });

/** Маршрут в первой странице списка (новый — в начало, тот же id — заменяется). */
export function withRouteOnTop(
  data: InfiniteData<MyRoutePage, string | null> | undefined,
  route: MyRoute,
): InfiniteData<MyRoutePage, string | null> | undefined {
  if (!data) return data;
  const pages = data.pages.map((page, index) => {
    const items = page.items.filter((item) => item.id !== route.id);
    return index === 0 ? { ...page, items: [route, ...items] } : { ...page, items };
  });
  return { ...data, pages };
}

/** «Переименовать»: ответ — в карточку и список. */
export function useRenameMyRoute(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      withAccessToken((token) => api.renameMyRoute(token, id, { title })),
    onSuccess: (route) => {
      queryClient.setQueryData(myRoutesKeys.detail(id), route);
      queryClient.setQueryData<InfiniteData<MyRoutePage, string | null>>(
        myRoutesKeys.list,
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) => (item.id === id ? route : item)),
                })),
              }
            : data,
      );
      void queryClient.invalidateQueries({ queryKey: myRoutesKeys.list });
    },
  });
}

/** «Удалить» насовсем: 404 (уже удалён) — тоже успех; карточка и карта убираются из кеша. */
export function useDeleteMyRoute(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await withAccessToken((token) => api.deleteMyRoute(token, id));
      } catch (error) {
        if (apiErrorOf(error)?.code !== 'NOT_FOUND') throw error;
      }
    },
    onSuccess: () => {
      queryClient.setQueryData<InfiniteData<MyRoutePage, string | null>>(
        myRoutesKeys.list,
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((item) => item.id !== id),
                })),
              }
            : data,
      );
      queryClient.removeQueries({ queryKey: myRoutesKeys.detail(id) });
      queryClient.removeQueries({ queryKey: myRoutesKeys.map(id) });
      void queryClient.invalidateQueries({ queryKey: myRoutesKeys.list });
    },
  });
}
