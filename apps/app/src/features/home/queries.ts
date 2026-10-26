import type { RideReason } from '@pokatim/contracts';
import { useQuery } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';

/** Сервер отдаёт публичные списки с `public, max-age=60` — чаще перезапрашивать незачем. */
const PUBLIC_LIST_STALE_MS = 60_000;

const NEXT_RACE = { scope: 'current', limit: 1 } as const;
const NEXT_CALENDAR_START = { limit: 1 } as const;

/**
 * Ближайшая гонка (A1): опубликованная с незакрытым окном, по началу окна — публичный список admin-02 без Bearer.
 * Ключ совместим со списком вкладки «Гонки» (префикс `['races', 'list']`).
 */
export function useNextRace() {
  return useQuery({
    queryKey: ['races', 'list', NEXT_RACE],
    queryFn: () => api.listRaces(NEXT_RACE),
    staleTime: PUBLIC_LIST_STALE_MS,
  });
}

/** Ближайший старт календаря (C1): `from` не передаём — «сегодня по Минску» берёт сервер. */
export function useNextCalendarStart() {
  return useQuery({
    queryKey: ['calendar', 'list', NEXT_CALENDAR_START],
    queryFn: () => api.listCalendar(NEXT_CALENDAR_START),
    staleTime: PUBLIC_LIST_STALE_MS,
  });
}

/** Профиль своего пользователя; после ответа на опрос — инвалидация (`useSubmitSurvey`), при выходе — `clear()`. */
export const PROFILE_QUERY_KEY = ['profile'] as const;
/** Запрос профиля — один для всех читателей ключа `PROFILE_QUERY_KEY` (Главная, экран «Профиль»). */
export const fetchProfile = () => withAccessToken((accessToken) => api.getProfile(accessToken));

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
    queryFn: fetchProfile,
    staleTime: Infinity,
    select: (profile) => profile.rideReasons,
  });
  return { reasons: query.data, refetch: query.refetch };
}
