import type { UpdateProfileRequest } from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { fetchProfile, PROFILE_QUERY_KEY } from '@/features/home/queries';
import { api } from '@/lib/api';

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
