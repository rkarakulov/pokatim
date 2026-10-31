import type { AvatarCrop } from '@pokatim/api-client';
import type {
  ProfileView,
  RiderRaceHistoryPage,
  RiderRideHistoryPage,
  UpdateProfileRequest,
  UpdateVerifiedProfileRequest,
} from '@pokatim/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { fetchProfile, PROFILE_QUERY_KEY } from '@/features/home/queries';
import { invalidateRouteRideLeaderboards } from '@/features/route-rides/queries';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

import { isAvatarBlockedError } from './avatar-errors';

/** Префикс публичных таблиц результатов гонок: после смены имени или согласия — инвалидация. */
const RACE_RESULTS_KEY = ['races', 'results'] as const;

/** Префикс публичного профиля райдера (`features/riders`): имя, клуб и фото меняются — инвалидация. */
const RIDERS_KEY = ['riders'] as const;

/** Профиль своего пользователя — тот же ключ и запрос, что у Главной (один кэш профиля, RC-10). */
export function useProfile() {
  return useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: fetchProfile });
}

/**
 * Id своего аватара для верхней панели Главной (rider-profile): тот же кэш и `staleTime`, что порядок разделов
 * (`useRideReasons`) — лишнего запроса нет. Пока профиль не пришёл или при ошибке — `null` (пустой квадрат).
 */
export function useOwnAvatarId(): string | null {
  const query = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: fetchProfile,
    staleTime: Infinity,
    select: (profile) => profile.avatar?.id ?? null,
  });
  return query.data ?? null;
}

/** Статистика своего профиля (`no-store` на сервере): считает сервер, клиент только показывает. */
export const PROFILE_STATS_KEY = ['profile', 'stats'] as const;

export function useProfileStats() {
  return useQuery({
    queryKey: PROFILE_STATS_KEY,
    queryFn: () => withAccessToken((accessToken) => api.getProfileStats(accessToken)),
    staleTime: DEFAULT_STALE_MS,
  });
}

/** Строк истории на странице (`RiderHistoryQuery`, по умолчанию сервера — тоже 10). */
export const HISTORY_LIMIT = 10;
const nextCursor = (page: RiderRaceHistoryPage | RiderRideHistoryPage) =>
  page.nextCursor ?? undefined;

/** «Гонки» своего профиля: «Показать ещё» по курсору; запрос — только у выбранной вкладки (`enabled`). */
export function useProfileRaces(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['profile', 'races', 'pages'],
    queryFn: ({ pageParam }) =>
      withAccessToken((accessToken) =>
        api.listProfileRaces(accessToken, {
          limit: HISTORY_LIMIT,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/** «Райды» своего профиля: первая страница — при первом переключении на вкладку. */
export function useProfileRides(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['profile', 'rides', 'pages'],
    queryFn: ({ pageParam }) =>
      withAccessToken((accessToken) =>
        api.listProfileRides(accessToken, {
          limit: HISTORY_LIMIT,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/**
 * Ответ мутации фото — полный профиль: только `setQueryData(['profile'])`, без префиксной инвалидации `['profile']`
 * (иначе перезапросились бы анкета, статистика и история); публичный профиль — инвалидация `['riders']`.
 */
function onAvatarChanged(queryClient: QueryClient, view: ProfileView) {
  queryClient.setQueryData(PROFILE_QUERY_KEY, view);
  void queryClient.invalidateQueries({ queryKey: RIDERS_KEY });
}

/** Загрузка фото (`PUT /v1/profile/avatar`): исходник и намерение обрезки; квадрат и пределы — сервер. */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, crop }: { body: Blob; crop?: AvatarCrop }) =>
      withAccessToken((accessToken) => api.uploadAvatar(accessToken, body, crop)),
    networkMode: 'always',
    onSuccess: (view) => onAvatarChanged(queryClient, view),
    // запрет включился, пока выбирали фото (гонка со сбросом): перечитать профиль — кнопка станет неактивной
    onError: (error) => {
      if (isAvatarBlockedError(error))
        void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}

/** Удаление фото (идемпотентно, `POST /v1/profile/avatar/delete`). */
export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withAccessToken((accessToken) => api.deleteAvatar(accessToken)),
    networkMode: 'always',
    onSuccess: (view) => onAvatarChanged(queryClient, view),
  });
}

/**
 * Имя, клуб и согласие на показ (`PATCH /v1/profile`): ответ — полный профиль → кэш `['profile']` без лишнего
 * запроса; таблицы результатов, публичный профиль `['riders']` и таблицы «Другие» маршрутов (route-rides-04: согласие
 * и имя своей строки) — инвалидация (имя меняется в чужих таблицах; публичный кэш ответа — до 60 с).
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      withAccessToken((accessToken) => api.updateProfile(accessToken, body)),
    networkMode: 'always',
    onSuccess: (view) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, view);
      void queryClient.invalidateQueries({ queryKey: RACE_RESULTS_KEY });
      void queryClient.invalidateQueries({ queryKey: RIDERS_KEY });
      // route-rides-04 (RC-B6): своё согласие и имя своей строки в таблицах «Другие»
      void invalidateRouteRideLeaderboards(queryClient);
    },
  });
}

/** Анкета зачёта (race-results-07): только владельцу, `no-store`. */
export const VERIFIED_PROFILE_KEY = ['profile', 'verified'] as const;
/** Префикс «моего участия» во всех гонках: после анкеты — `verified.profileReady` и `groupOptions` меняются. */
const RACE_ENTRY_KEY = ['races', 'entry'] as const;

export function useVerifiedProfile() {
  return useQuery({
    queryKey: VERIFIED_PROFILE_KEY,
    queryFn: () => withAccessToken((accessToken) => api.getVerifiedProfile(accessToken)),
    staleTime: DEFAULT_STALE_MS,
  });
}

/**
 * Сохранение анкеты (`PUT /v1/profile/verified`): ответ — в кэш анкеты; «моё участие» гонок устаревает (анкета
 * открывает Verified и группы). Отказ `VERIFIED_DEMOGRAPHICS_LOCKED` — анкета перезапрашивается (пол и год заблокированы).
 */
export function useUpdateVerifiedProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateVerifiedProfileRequest) =>
      withAccessToken((accessToken) => api.updateVerifiedProfile(accessToken, body)),
    networkMode: 'always',
    onSuccess: (view) => {
      queryClient.setQueryData(VERIFIED_PROFILE_KEY, view);
      void queryClient.invalidateQueries({ queryKey: RACE_ENTRY_KEY });
    },
  });
}
