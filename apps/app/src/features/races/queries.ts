import type {
  AttemptRequest,
  MyAttempt,
  MyAttemptTrack,
  MyRaceEntry,
  MyTicketRef,
  RaceDetail,
  RaceEntryRequest,
  RaceFinishersPage,
  RacePage,
  RaceResultsPage,
  ResultGroupKey,
  RaceRouteMap,
  CurrentSeasonResponse,
  SeasonCard,
} from '@pokatim/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { apiErrorCode } from '@/features/auth/error-messages';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { offerPushSoftPrompt } from '@/features/notifications/push-soft-prompt-store';
import { VERIFIED_PROFILE_KEY } from '@/features/profile/queries';
import { forgetCancelledTicket } from '@/features/tickets/queries';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

import type { RaceFilters } from './filters';
import { isRaceErrorCode, needsPolling, resultSignature } from './participation-format';
import { pickSeason } from './season-pick';

/** Сервер отдаёт публичное чтение с `public, max-age=60` — чаще перезапрашивать незачем. */
export const PUBLIC_STALE_MS = 60_000;
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

/**
 * Линия показа коридора для карты (ADR-0014): только клиент (в SSR не попадает). Коридор опубликованной гонки до
 * старта правится — pull-to-refresh карточки перезапрашивает (`useRaceRouteRefetch`). 404 (нет коридора, старый
 * API) не повторяется (`shouldRetry`).
 */
export function useRaceRoute(id: string, enabled: boolean) {
  return useQuery<RaceRouteMap>({
    queryKey: ['races', 'route', id],
    queryFn: () => api.getRaceRoute(id),
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/**
 * Pull-to-refresh карточки: перезапрос карты, если она на экране, — коридор (маршрут, допуск) у опубликованной
 * гонки до старта правится, ключ этого не знает.
 */
export function useRaceRouteRefetch(id: string) {
  const client = useQueryClient();
  return useCallback(
    () => client.refetchQueries({ queryKey: ['races', 'route', id], type: 'active' }),
    [client, id],
  );
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
const currentSeasonQuery = {
  queryKey: ['seasons', 'current'],
  queryFn: () => api.getCurrentSeason(),
  staleTime: PUBLIC_STALE_MS,
};

/**
 * Текущий сезон без подбора между сезонами (гостевой лендинг, RC-10): тот же ключ, что у `useHeaderSeason` (кэш общий);
 * `seed` — посев SSR (`initialData`).
 */
export function useCurrentSeason(seed?: CurrentSeasonResponse) {
  return useQuery({ ...currentSeasonQuery, initialData: seed });
}

export function useHeaderSeason(): SeasonCard | null {
  const current = useQuery(currentSeasonQuery);
  const between = current.isSuccess && current.data.season === null;
  const all = useSeasons(between);
  if (!current.isSuccess) return null;
  if (current.data.season) return current.data.season;
  return all.data ? pickSeason(null, all.data.items) : null;
}

/**
 * Тот же выбор сезона, что `useHeaderSeason` (тот же кэш), но с состоянием запросов — для блока со своими
 * состояниями §4.12 («Сезон» «Профиля», 08c): сохранённые данные не теряются при ошибке обновления. `between` — текущего
 * нет, сезон выбирается из списка (`all`).
 */
export function useHeaderSeasonState() {
  const current = useQuery(currentSeasonQuery);
  const between = current.data !== undefined && current.data.season === null;
  const all = useSeasons(between);
  const season =
    current.data === undefined
      ? null
      : (current.data.season ?? (all.data ? pickSeason(null, all.data.items) : null));
  return { season, current, all, between };
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
/** Свой билет гонки (event-tickets): под префиксом гонок, инвалидируется мутациями участия. */
export const raceTicketKey = (id: string) => ['races', 'ticket', id] as const;
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
    staleTime: DEFAULT_STALE_MS,
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

/**
 * Ключ своего трека попытки (maps-02) — под `raceEntryKey` (инвалидация участия накрывает трек) с маркером ревизии
 * попытки (RC-4): опрос участия пишет кеш через `setQueryData` без каскада на дочерние ключи — новый статус или
 * `checkedAt` дают новый ключ, и трек перезапрашивается после вердикта.
 */
export const myAttemptTrackKey = (
  raceId: string,
  attemptId: string,
  status: string,
  checkedAt: string | null,
) => [...raceEntryKey(raceId), 'attempts', attemptId, 'track', status, checkedAt] as const;

/**
 * Свой трек попытки (только вошедшему, только клиент): данные меняются только с маркером ревизии в ключе — свежи
 * бессрочно, своего опроса нет. 404 (старый API, удалённая активность, попытка скрыта) — `null`: карта без трека и
 * без строки ошибки (RC-8).
 */
export function useMyAttemptTrack(raceId: string, attempt: MyAttempt | null, enabled: boolean) {
  return useQuery({
    queryKey: myAttemptTrackKey(
      raceId,
      attempt?.id ?? '',
      attempt?.status ?? '',
      attempt?.checkedAt ?? null,
    ),
    queryFn: async (): Promise<MyAttemptTrack | null> => {
      try {
        return await withAccessToken((token) => api.getMyAttemptTrack(token, raceId, attempt!.id));
      } catch (error) {
        if (apiErrorCode(error) === 'NOT_FOUND') return null;
        throw error;
      }
    },
    staleTime: Infinity,
    enabled: enabled && attempt !== null,
  });
}

const nextResultsCursor = (page: RaceResultsPage) => page.nextCursor ?? undefined;

/**
 * Предварительная таблица: страницы по 50, «Показать ещё» по `nextCursor`. Без `group` — группа по умолчанию сервера
 * (ключ `[…, 'pages']`); `group` (race-results-07) — вкладка группы (`[…, 'pages', group]`). `group` передают только
 * после ответа с непустым `groups` (RC-11: старый сервер ответил бы 400 на лишний ключ).
 */
export function useRaceResults(id: string, enabled: boolean, group?: ResultGroupKey) {
  return useInfiniteQuery({
    queryKey: group ? [...raceResultsKey(id), 'pages', group] : [...raceResultsKey(id), 'pages'],
    queryFn: ({ pageParam }) =>
      api.getRaceResults(id, {
        limit: RESULTS_PAGE_LIMIT,
        ...(group ? { group } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: nextResultsCursor,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

const nextFinishersCursor = (page: RaceFinishersPage) => page.nextCursor ?? undefined;

/**
 * Финишёры (race-results-07): START и Verified без пульса — без мест, публично. Ключ под префиксом таблицы —
 * инвалидация таблицы накрывает и его.
 */
export function useRaceFinishers(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...raceResultsKey(id), 'finishers'],
    queryFn: ({ pageParam }) =>
      api.getRaceFinishers(id, {
        limit: RESULTS_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: nextFinishersCursor,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/**
 * Pull-to-refresh карточки: все активные запросы таблицы (`raceResultsKey`) — группа по умолчанию, выбранная вкладка
 * группы и «Финишёры» (их запросы живут в `RaceResultsTable`, карточка их не держит).
 */
export function useRaceResultsRefetch(id: string) {
  const client = useQueryClient();
  return useCallback(
    () => client.refetchQueries({ queryKey: raceResultsKey(id), type: 'active' }),
    [client, id],
  );
}

/** Свои заезды в окне гонки для «Выбрать свой заезд». */
export function useAttemptCandidates(id: string, enabled: boolean) {
  return useQuery({
    queryKey: raceCandidatesKey(id),
    queryFn: () => withAccessToken((token) => api.listAttemptCandidates(token, id)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/** Ответ мутации — в кеш участия; затем таблица и кандидаты устаревают. */
async function applyEntry(queryClient: QueryClient, entry: MyRaceEntry): Promise<void> {
  // опрос или обновление, ушедшие во время мутации, несут состояние до неё — их ответ не должен затереть этот
  await queryClient.cancelQueries({ queryKey: raceEntryKey(entry.raceId) });
  queryClient.setQueryData(raceEntryKey(entry.raceId), entry);
  // заявки больше нет — билет отменён: офлайн-копия с QR стирается (event-tickets)
  if (entry.entry?.status !== 'active') {
    forgetCancelledTicket(
      queryClient,
      queryClient.getQueryData<MyTicketRef | null>(raceTicketKey(entry.raceId))?.code,
    );
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: raceResultsKey(entry.raceId) }),
    queryClient.invalidateQueries({ queryKey: raceCandidatesKey(entry.raceId) }),
    // заявка и её отмена выпускают и отменяют билет (event-tickets): билет гонки и «Ваши билеты» устарели
    queryClient.invalidateQueries({ queryKey: raceTicketKey(entry.raceId) }),
    queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  ]);
}

/**
 * Свой билет гонки (event-tickets, «Открыть билет» в «Ваше участие»): сервер выпускает лениво; нет билетов или
 * заявки — `null`; старый API без эндпоинта (404) — `null` (кнопки нет).
 */
export function useRaceTicket(id: string, enabled: boolean) {
  return useQuery({
    queryKey: raceTicketKey(id),
    queryFn: async (): Promise<MyTicketRef | null> => {
      try {
        return await withAccessToken((token) => api.getRaceTicket(token, id));
      } catch (error) {
        if (apiErrorCode(error) === 'NOT_FOUND') return null;
        throw error;
      }
    },
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/**
 * Мутация участия: ответ — в кеш; отказ 409 участия — `actions` устарели, участие перезапрашивается (F14).
 * `staleAfter` — ключи, которые устаревают после успеха (по телу запроса).
 */
function useEntryMutation<V>(
  id: string,
  call: (token: string, body: V) => Promise<MyRaceEntry>,
  staleAfter?: (body: V) => readonly QueryKey[],
  /** заявка стала активной (новая запись, не повышение уровня) — до записи в кеш и инвалидаций */
  onEntered?: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...AUTH_MUTATION,
    // опрос, начатый до мутации, отменяем сразу: его ответ не придёт поверх ответа мутации
    onMutate: () => queryClient.cancelQueries({ queryKey: raceEntryKey(id) }),
    mutationFn: (body: V) => withAccessToken((token) => call(token, body)),
    onSuccess: async (entry, body) => {
      const before = queryClient.getQueryData<MyRaceEntry | null>(raceEntryKey(id));
      if (entry.entry?.status === 'active' && before?.entry?.status !== 'active') onEntered?.();
      await applyEntry(queryClient, entry);
      await Promise.all(
        (staleAfter?.(body) ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
    onError: (error) => {
      if (isRaceErrorCode(apiErrorCode(error))) {
        void queryClient.invalidateQueries({ queryKey: raceEntryKey(id) });
      }
    },
  });
}

/**
 * «Участвовать» и «Повысить до Verified» (race-results-07): без тела — прежняя заявка (схема `overall`, старый API);
 * `{ tier, groupKey }` — намерение, правила проверяет сервер.
 */
export const useEnterRace = (id: string) =>
  useEntryMutation<NonNullable<RaceEntryRequest> | void>(
    id,
    (token, body) => (body ? api.enterRace(token, id, body) : api.enterRace(token, id)),
    // Verified-заявка фиксирует пол и год анкеты — кэш анкеты устарел (иначе откроется редактируемой)
    (body) => (body && body.tier === 'verified' ? [VERIFIED_PROFILE_KEY] : []),
    // новая запись — подсказка push (N5); форма «Участвовать» к ответу уже размонтирована — не из `mutate`
    () => offerPushSoftPrompt('race', id),
  );

/** «Отменить участие». */
export const useWithdrawFromRace = (id: string) =>
  useEntryMutation<void>(id, (token) => api.withdrawFromRace(token, id));

/** Попытка: «Выбрать свой заезд» (`activityId`) или загруженный в гонку файл (`uploadId`). */
export const useAddRaceAttempt = (id: string) =>
  useEntryMutation<AttemptRequest>(id, (token, body) => api.addRaceAttempt(token, id, body));
