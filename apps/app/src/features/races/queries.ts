import type {
  AttemptRequest,
  MyRaceEntry,
  RaceDetail,
  RacePage,
  RaceResultsPage,
  SeasonCard,
} from '@pokatim/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { apiErrorCode } from '@/features/auth/error-messages';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { api } from '@/lib/api';

import type { RaceFilters } from './filters';
import { isRaceErrorCode, needsPolling, resultSignature } from './participation-format';
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

/*
 * Участие и результат (race-results-04). «Моё участие» и кандидаты — только вошедшему (`withAccessToken`, сервер
 * `no-store`); таблица — публичная (`public, max-age=60`). Мутации: ответ `MyRaceEntry` → кеш участия, затем таблица
 * и кандидаты устаревают. Статусы, место и права — только из ответа сервера.
 */

export const raceEntryKey = (id: string) => ['races', 'entry', id] as const;
/** Префикс инвалидации таблицы; сами страницы — `[...raceResultsKey(id), 'pages']` (F12). */
export const raceResultsKey = (id: string) => ['races', 'results', id] as const;
export const raceCandidatesKey = (id: string) => ['races', 'candidates', id] as const;
/** Опрос «моего участия», пока трек проверяется или файл обрабатывается (§7.3; polling, не сокеты). */
export const ENTRY_POLL_MS = 3000;
const RESULTS_PAGE_LIMIT = 50;

/**
 * «Моё участие» (только вошедшему). Старый API без эндпоинта (404) — `null`: блока нет (R4, F9). Опрос — пока
 * `needsPolling`; смена результата между ответами (не первый ответ) — таблица перезапрашивается: место появляется
 * тихо, без уведомления (D-37, F13).
 */
export function useMyRaceEntry(id: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: raceEntryKey(id),
    queryFn: async (): Promise<MyRaceEntry | null> => {
      try {
        return await withAccessToken((token) => api.getMyRaceEntry(token, id));
      } catch (error) {
        if (apiErrorCode(error) === 'NOT_FOUND') return null;
        throw error;
      }
    },
    staleTime: 0,
    refetchInterval: (q) => (needsPolling(q.state.data) ? ENTRY_POLL_MS : false),
    enabled,
  });

  const signature = resultSignature(query.data);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (previous.current !== null && previous.current !== signature) {
      void queryClient.invalidateQueries({ queryKey: raceResultsKey(id) });
    }
    previous.current = signature;
  }, [signature, id, queryClient]);

  return query;
}

const nextResultsCursor = (page: RaceResultsPage) => page.nextCursor ?? undefined;

/** Предварительная таблица: страницы по 50, «Показать ещё» по `nextCursor`. */
export function useRaceResults(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...raceResultsKey(id), 'pages'],
    queryFn: ({ pageParam }) =>
      api.getRaceResults(id, {
        limit: RESULTS_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: nextResultsCursor,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/** Свои заезды в окне гонки для «Выбрать свой заезд». */
export function useAttemptCandidates(id: string, enabled: boolean) {
  return useQuery({
    queryKey: raceCandidatesKey(id),
    queryFn: () => withAccessToken((token) => api.listAttemptCandidates(token, id)),
    staleTime: 0,
    enabled,
  });
}

/** Ответ мутации — в кеш участия; затем таблица и кандидаты устаревают. */
async function applyEntry(queryClient: QueryClient, entry: MyRaceEntry): Promise<void> {
  queryClient.setQueryData(raceEntryKey(entry.raceId), entry);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: raceResultsKey(entry.raceId) }),
    queryClient.invalidateQueries({ queryKey: raceCandidatesKey(entry.raceId) }),
  ]);
}

/** Мутация участия: ответ — в кеш; отказ 409 участия — `actions` устарели, участие перезапрашивается (F14). */
function useEntryMutation<V>(id: string, call: (token: string, body: V) => Promise<MyRaceEntry>) {
  const queryClient = useQueryClient();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: V) => withAccessToken((token) => call(token, body)),
    onSuccess: (entry) => applyEntry(queryClient, entry),
    onError: (error) => {
      if (isRaceErrorCode(apiErrorCode(error))) {
        void queryClient.invalidateQueries({ queryKey: raceEntryKey(id) });
      }
    },
  });
}

/** «Участвовать». */
export const useEnterRace = (id: string) =>
  useEntryMutation<void>(id, (token) => api.enterRace(token, id));

/** «Отменить участие». */
export const useWithdrawFromRace = (id: string) =>
  useEntryMutation<void>(id, (token) => api.withdrawFromRace(token, id));

/** Попытка: «Выбрать свой заезд» (`activityId`) или загруженный в гонку файл (`uploadId`). */
export const useAddRaceAttempt = (id: string) =>
  useEntryMutation<AttemptRequest>(id, (token, body) => api.addRaceAttempt(token, id, body));
