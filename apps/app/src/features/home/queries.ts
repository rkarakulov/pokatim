import type { RideReason } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';

/** Профиль своего пользователя; после ответа на опрос — инвалидация (`useSubmitSurvey`), при выходе — `clear()`. */
export const PROFILE_QUERY_KEY = ['profile'] as const;

/**
 * Ответы опроса для порядка разделов Главной (R4). `reasons === undefined` — профиль ещё не пришёл или не
 * загрузился: порядок по умолчанию, ошибка на экране не показывается. Ответы меняются только опросом —
 * `staleTime: Infinity`; ручное обновление — `refetch` (pull-to-refresh).
 */
export function useRideReasons(): {
  reasons: readonly RideReason[] | undefined;
  refetch: () => Promise<unknown>;
} {
  const query = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => withAccessToken((accessToken) => api.getProfile(accessToken)),
    staleTime: Infinity,
    select: (profile) => profile.rideReasons,
  });
  return { reasons: query.data, refetch: query.refetch };
}
