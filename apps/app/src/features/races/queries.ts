import type { RaceDetail, RacePage, SeasonCard } from '@pokatim/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { RaceFilters } from './filters';
import { pickSeason } from './season-pick';

/** Сервер отдаёт публичное чтение с `public, max-age=60` — чаще перезапрашивать незачем. */
const PUBLIC_STALE_MS = 60_000;
const PAGE_LIMIT = 20;

const nextCursor = (page: RacePage) => page.nextCursor ?? undefined;

/**
 * Страницы списка гонок вкладки. Ключ — `['races', 'list', {…}, 'pages']`: форма `InfiniteData` не совпадает с
 * ключом Главной (`['races', 'list', { scope, limit: 1 }]`), префикс общий — инвалидация накрывает оба.
 */
function useRacePages(scope: 'current' | 'past', filters: RaceFilters, enabled: boolean) {
  const params = { scope, bikeClass: filters.bikeClass, month: filters.month, limit: PAGE_LIMIT };
  return useInfiniteQuery({
    queryKey: ['races', 'list', params, 'pages'],
    queryFn: ({ pageParam }) =>
      api.listRaces({
        scope,
        bikeClass: [...filters.bikeClass],
        month: [...filters.month],
        limit: PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/**
 * Лента вкладки «Гонки» (§7): `current` (открытые и предстоящие, по началу окна) — всегда; `past` (закрытые и
 * отменённые, новые сверху) — только после исчерпания `current` (Q4). Подгрузка у конца — следующая страница
 * `current`, иначе `past`.
 */
export function useRaceFeed(filters: RaceFilters) {
  const current = useRacePages('current', filters, true);
  const pastEnabled = current.isSuccess && !current.hasNextPage;
  const past = useRacePages('past', filters, pastEnabled);

  // идёт обновление (pull-to-refresh, фокус) — не догружаем: fetchNextPage по умолчанию отменил бы refetch и
  // обновлённые страницы потерялись бы (ревью pass 1 блока 04)
  const loadMore = () => {
    if (current.hasNextPage) {
      if (!current.isFetching && !current.isFetchNextPageError)
        void current.fetchNextPage({ cancelRefetch: false });
      return;
    }
    if (pastEnabled && past.hasNextPage && !past.isFetching && !past.isFetchNextPageError) {
      void past.fetchNextPage({ cancelRefetch: false });
    }
  };

  return { current, past, pastEnabled, loadMore };
}

/** Карточка гонки: посев SSR (`initialData`) — только web; 404 — `ApiHttpError` со статусом. */
export function useRace(id: string, seed: RaceDetail | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['races', 'detail', id],
    queryFn: () => api.getRace(id),
    initialData: seed,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

export function useSeason(id: string, seed: SeasonCard | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['seasons', 'detail', id],
    queryFn: () => api.getSeason(id),
    initialData: seed,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/** Гонки сезона по концу окна, курсор. */
export function useSeasonRaces(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['seasons', 'races', id, 'pages'],
    queryFn: ({ pageParam }) =>
      api.listSeasonRaces(id, { limit: PAGE_LIMIT, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/** Все сезоны, новые сверху. */
export function useSeasons(enabled = true) {
  return useQuery({
    queryKey: ['seasons', 'list'],
    queryFn: () => api.listSeasons(),
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/**
 * Сезон для кнопки в шапке вкладки (Q3, R10): текущий; между сезонами — из списка (ближайший предстоящий, иначе
 * последний завершённый). Пока не известен или не загрузился — `null` (кнопки нет, ошибка на экране не нужна).
 */
export function useHeaderSeason(): SeasonCard | null {
  const current = useQuery({
    queryKey: ['seasons', 'current'],
    queryFn: () => api.getCurrentSeason(),
    staleTime: PUBLIC_STALE_MS,
  });
  const between = current.isSuccess && current.data.season === null;
  const all = useSeasons(between);
  if (!current.isSuccess) return null;
  if (current.data.season) return current.data.season;
  return all.data ? pickSeason(null, all.data.items) : null;
}
