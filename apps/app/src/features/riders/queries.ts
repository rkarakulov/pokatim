import { ApiHttpError } from '@pokatim/api-client';
import type {
  CreateProfileReportRequest,
  PublicRiderProfile,
  PublicRiderRacePage,
} from '@pokatim/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

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

const riderRacesKey = (id: string) => ['riders', 'races', id, 'pages'] as const;

/**
 * Публичная история гонок: только опубликованные протоколы, новые сверху, «Показать ещё»; только клиент. Курсор —
 * id гонки: строка выпала из новой ревизии протокола — сервер отвечает 400 на курсор; тогда список сбрасывается к
 * первой странице (`resetQueries`), а не застревает с ошибкой догрузки.
 */
export function useRiderRaces(id: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: riderRacesKey(id),
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
  const staleCursor =
    query.isFetchNextPageError && query.error instanceof ApiHttpError && query.error.status === 400;
  useEffect(() => {
    if (staleCursor) void queryClient.resetQueries({ queryKey: riderRacesKey(id), exact: true });
  }, [staleCursor, queryClient, id]);
  return query;
}

/**
 * Состояние вошедшего зрителя публичного профиля (profile-report-app): `canReport` / `reported` решает сервер
 * (`GET /v1/riders/:publicId/me`). Только клиент и только вошедшему; кеш стирается при выходе.
 */
export const riderViewerKey = (id: string) => ['riders', 'viewer', id] as const;

export function useRiderViewer(id: string, enabled: boolean) {
  return useQuery({
    queryKey: riderViewerKey(id),
    queryFn: () => withAccessToken((token) => api.getRiderViewer(token, id)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/** «Пожаловаться» на профиль: ответ — новое состояние зрителя (`reported: true`). */
export function useReportRider(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProfileReportRequest) =>
      withAccessToken((token) => api.reportRider(token, id, body)),
    onSuccess: (viewer) => queryClient.setQueryData(riderViewerKey(id), viewer),
  });
}
