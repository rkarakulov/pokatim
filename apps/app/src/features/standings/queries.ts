import type {
  BikeClass,
  MySeasonStandings,
  ResultGroupKey,
  SeasonStandingsTable,
} from '@pokatim/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { PUBLIC_STALE_MS } from '@/features/races/queries';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

import { BYPASS_HTTP_CACHE } from './http-cache';

/*
 * Рейтинг сезона (race-results-08c): сводка и таблица — публичные (`public, max-age=60`), «моё» — только вошедшему
 * (`no-store`, `withAccessToken`; при выходе кэш стирается целиком — `queryClient.clear()` корневого layout).
 * Префикс `['seasons','standings',id]` — pull-to-refresh экрана перезапрашивает всё активное под ним.
 */

export const standingsKey = (seasonId: string) => ['seasons', 'standings', seasonId] as const;
export const standingsTableKey = (
  seasonId: string,
  bikeClass: BikeClass,
  groupKey: ResultGroupKey,
) => [...standingsKey(seasonId), 'table', bikeClass, groupKey] as const;
export const myStandingsKey = (seasonId: string) => [...standingsKey(seasonId), 'me'] as const;

const STANDINGS_PAGE_LIMIT = 50;

/** Сводка: время пересчёта и список таблиц «класс × группа». */
export function useSeasonStandings(seasonId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...standingsKey(seasonId), 'summary'],
    queryFn: () => api.getSeasonStandings(seasonId),
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

const nextCursor = (page: SeasonStandingsTable) => page.nextCursor ?? undefined;

/**
 * Таблица «класс × группа» по курсору («Показать ещё»). Курсор не привязан к снимку (ревью 08a LOW-2): страница
 * другого пересчёта (`computedAt` отличается от первой) — подгруженное сбрасывается, таблица грузится с первой
 * страницы. Этот сброс и `refetchFresh` (RC-11) идут в обход HTTP-кэша там, где это возможно (`http-cache.ts`):
 * иначе повтор вернул бы тот же ответ `max-age=60`.
 */
export function useSeasonStandingsTable(
  seasonId: string,
  table: { bikeClass: BikeClass; groupKey: ResultGroupKey } | null,
) {
  const client = useQueryClient();
  const bikeClass = table?.bikeClass ?? 'road';
  const groupKey = table?.groupKey ?? 'overall';
  const queryKey = useMemo(
    () => standingsTableKey(seasonId, bikeClass, groupKey),
    [seasonId, bikeClass, groupKey],
  );
  // перезапрос после расхождения снимков идёт, пока флаг поднят
  const fresh = useRef(false);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      const params = {
        bikeClass,
        group: groupKey,
        limit: STANDINGS_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      };
      return BYPASS_HTTP_CACHE && fresh.current
        ? api.getSeasonStandingsTable(seasonId, params, { fresh: true })
        : api.getSeasonStandingsTable(seasonId, params);
    },
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: PUBLIC_STALE_MS,
    enabled: table !== null,
  });
  const pages = query.data?.pages;
  const mixed =
    pages !== undefined && pages.some((page) => page.computedAt !== pages[0]?.computedAt);
  const freshly = useCallback(async (run: () => Promise<unknown>) => {
    fresh.current = true;
    try {
      await run();
    } finally {
      fresh.current = false;
    }
  }, []);
  useEffect(() => {
    if (mixed) void freshly(() => client.resetQueries({ queryKey, exact: true }));
  }, [mixed, client, queryKey, freshly]);
  const { refetch } = query;
  const refetchFresh = useCallback(() => freshly(() => refetch()), [freshly, refetch]);
  return { ...query, refetchFresh };
}

/** Свои строки во всех таблицах сезона (только вошедшему). */
export function useMySeasonStandings(seasonId: string, enabled: boolean) {
  return useQuery<MySeasonStandings>({
    queryKey: myStandingsKey(seasonId),
    queryFn: () => withAccessToken((token) => api.getMySeasonStandings(token, seasonId)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/** Pull-to-refresh экрана сезона: сводка, выбранная таблица и «моё» (их запросы живут в блоке таблицы). */
export function useStandingsRefetch(seasonId: string) {
  const client = useQueryClient();
  return useCallback(
    () => client.refetchQueries({ queryKey: standingsKey(seasonId), type: 'active' }),
    [client, seasonId],
  );
}
