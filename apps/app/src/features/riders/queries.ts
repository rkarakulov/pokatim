import type { PublicRiderProfile, PublicRiderRacePage } from '@pokatim/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * Публичный профиль райдера (rider-profile) — чтение без `withAccessToken`; сервер отдаёт `public, max-age=60` — чаще
 * перезапрашивать незачем. 404 (нет профиля, нет согласия, неизвестный id) не повторяется (`shouldRetry`). Префикс
 * `['riders']` инвалидируют мутации своего профиля (имя, клуб, фото).
 */
const PUBLIC_STALE_MS = 60_000;
/** Гонок на странице публичной истории. */
const RIDER_RACES_LIMIT = 10;

export const riderKey = (id: string) => ['riders', 'detail', id] as const;

/** Профиль по `publicId`: посев SSR (`initialData`) — только web. */
export function useRider(id: string, seed: PublicRiderProfile | undefined, enabled: boolean) {
  return useQuery({
    queryKey: riderKey(id),
    queryFn: () => api.getRider(id),
    initialData: seed,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/** Публичная история гонок: только опубликованные протоколы, новые сверху, «Показать ещё»; только клиент. */
export function useRiderRaces(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['riders', 'races', id, 'pages'],
    queryFn: ({ pageParam }) =>
      api.listRiderRaces(id, {
        limit: RIDER_RACES_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page: PublicRiderRacePage) => page.nextCursor ?? undefined,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}
