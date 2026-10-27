import type { UpdateProfileRequest, UpdateVerifiedProfileRequest } from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { fetchProfile, PROFILE_QUERY_KEY } from '@/features/home/queries';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

/** Префикс публичных таблиц результатов гонок: после смены имени или согласия — инвалидация. */
const RACE_RESULTS_KEY = ['races', 'results'] as const;

/** Профиль своего пользователя — тот же ключ и запрос, что у Главной (один кэш профиля, RC-10). */
export function useProfile() {
  return useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: fetchProfile });
}

/**
 * Имя и согласие на показ (`PATCH /v1/profile`): ответ — полный профиль → кэш `['profile']` без лишнего запроса;
 * таблицы результатов — инвалидация (имя меняется в чужих таблицах; публичный кэш ответа — до 60 с).
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
