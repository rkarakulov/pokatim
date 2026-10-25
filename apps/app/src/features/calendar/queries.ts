import type { CalendarPage, CalendarStartDetail } from '@pokatim/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { CalendarFilters } from './filters';

/** Сервер отдаёт публичное чтение с `public, max-age=60` — чаще перезапрашивать незачем. */
const PUBLIC_STALE_MS = 60_000;
const PAGE_LIMIT = 20;

const nextCursor = (page: CalendarPage) => page.nextCursor ?? undefined;

/**
 * Страницы календаря вкладки (одна выдача, без `scope`). Ключ — `['calendar', 'list', {…}, 'pages']`: форма
 * `InfiniteData` не совпадает с ключом Главной (`['calendar', 'list', { limit: 1 }]`), префикс общий. `from` не
 * передаём — «сегодня по Минску» берёт сервер. Подгрузка у конца — `loadMore`.
 */
export function useCalendarFeed(filters: CalendarFilters) {
  const params = {
    discipline: filters.discipline,
    city: filters.city,
    month: filters.month,
    limit: PAGE_LIMIT,
  };
  const feed = useInfiniteQuery({
    queryKey: ['calendar', 'list', params, 'pages'],
    queryFn: ({ pageParam }) =>
      api.listCalendar({
        discipline: [...filters.discipline],
        city: [...filters.city],
        month: [...filters.month],
        limit: PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: PUBLIC_STALE_MS,
  });

  // идёт обновление (pull-to-refresh, фокус) — не догружаем: fetchNextPage по умолчанию отменил бы refetch и
  // обновлённая первая страница потерялась бы; `cancelRefetch: false` — та же защита на гонке состояний
  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) {
      void feed.fetchNextPage({ cancelRefetch: false });
    }
  };

  return { feed, loadMore };
}

/** Месяцы будущих стартов — чипы «Дата» (Q2). */
export function useCalendarMonths() {
  return useQuery({
    queryKey: ['calendar', 'months'],
    queryFn: () => api.listCalendarMonths(),
    staleTime: PUBLIC_STALE_MS,
  });
}

/** Города будущих стартов — чипы «Город». */
export function useCalendarCities() {
  return useQuery({
    queryKey: ['calendar', 'cities'],
    queryFn: () => api.listCalendarCities(),
    staleTime: PUBLIC_STALE_MS,
  });
}

/** Карточка старта: посев SSR (`initialData`) — только web; 404 — `ApiHttpError` со статусом. */
export function useCalendarStart(
  id: string,
  seed: CalendarStartDetail | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['calendar', 'detail', id],
    queryFn: () => api.getCalendarStart(id),
    initialData: seed,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}
