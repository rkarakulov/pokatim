import type {
  RouteRideDetail,
  RouteRidePage,
  RouteRideRequest,
  RouteRideTrack,
} from '@pokatim/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { apiErrorCode } from '@/features/auth/error-messages';
import { withAccessToken } from '@/features/auth/authorized';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

import { isPendingCheck } from './route-ride-format';

/**
 * Заезд по маршруту (route-rides-02): только свои данные — всё через `withAccessToken`, только клиент. Префикс
 * `['route-rides', routeId]` не пересекается с `['routes', …]`; при выходе кеш стирается целиком.
 */
export const routeRidesKeys = {
  all: (routeId: string) => ['route-rides', routeId] as const,
  list: (routeId: string) => ['route-rides', routeId, 'list'] as const,
  candidates: (routeId: string) => ['route-rides', routeId, 'candidates'] as const,
  detail: (routeId: string, rideId: string) => ['route-rides', routeId, 'ride', rideId] as const,
  // отдельная ветка: инвалидация детали не задевает трек
  track: (routeId: string, rideId: string, status: string, checkedAt: string | null) =>
    ['route-rides', routeId, 'track', rideId, status, checkedAt] as const,
  upload: (routeId: string, uploadId: string) =>
    ['route-rides', routeId, 'upload', uploadId] as const,
};

/** Опрос списка и детали, пока проверка идёт (`queued | checking`). */
export const ROUTE_RIDE_POLL_MS = 3000;
/** Деталь после `ROUTE_RIDE_FAST_POLL_FOR_MS` незавершённой проверки (RC-6). */
export const ROUTE_RIDE_SLOW_POLL_MS = 15_000;
export const ROUTE_RIDE_FAST_POLL_FOR_MS = 120_000;
/** Опрос готовности загрузки вместо повторов POST (RC-1). */
export const UPLOAD_READY_POLL_MS = 2000;
export const UPLOAD_READY_TIMEOUT_MS = 60_000;

const isNotFound = (error: unknown) => apiErrorCode(error) === 'NOT_FOUND';

/**
 * Свои заезды по маршруту: 404 (маршрут стал невидим) — `null` (блока нет); опрос раз в 3 с, пока есть строки
 * `queued | checking` (RC-5).
 */
export function useRouteRides(routeId: string, enabled: boolean) {
  return useQuery({
    queryKey: routeRidesKeys.list(routeId),
    queryFn: async (): Promise<RouteRidePage | null> => {
      try {
        return await withAccessToken((token) => api.listRouteRides(token, routeId));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    staleTime: DEFAULT_STALE_MS,
    refetchInterval: (query) =>
      query.state.data?.items.some((row) => isPendingCheck(row.status))
        ? ROUTE_RIDE_POLL_MS
        : false,
    enabled,
  });
}

/** Кандидаты «Выбрать свой заезд» — и для `useQuery`, и для `fetchQuery` («Проверить снова», RC-2). */
export const routeRideCandidatesOptions = (routeId: string) =>
  queryOptions({
    queryKey: routeRidesKeys.candidates(routeId),
    queryFn: () => withAccessToken((token) => api.listRouteRideCandidates(token, routeId)),
    staleTime: DEFAULT_STALE_MS,
  });

export function useRouteRideCandidates(routeId: string, enabled: boolean) {
  return useQuery({ ...routeRideCandidatesOptions(routeId), enabled });
}

/**
 * Заезд по маршруту. 404 — ошибка (экран «Заезд не найден»). Опрос, пока проверка идёт: 3 с первые 2 мин от первого
 * показа незавершённого статуса, затем 15 с (RC-6); в фоне не опрашивается. Статус стал финальным — список блока
 * карточки устарел (RC-5).
 */
export function useRouteRide(routeId: string, rideId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const pendingSince = useRef<number | null>(null);
  const query = useQuery({
    queryKey: routeRidesKeys.detail(routeId, rideId),
    queryFn: () => withAccessToken((token) => api.getRouteRide(token, routeId, rideId)),
    staleTime: DEFAULT_STALE_MS,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data || !isPendingCheck(data.status) || isNotFound(q.state.error)) {
        pendingSince.current = null;
        return false;
      }
      pendingSince.current ??= Date.now();
      return Date.now() - pendingSince.current < ROUTE_RIDE_FAST_POLL_FOR_MS
        ? ROUTE_RIDE_POLL_MS
        : ROUTE_RIDE_SLOW_POLL_MS;
    },
    enabled,
  });

  const status = query.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (
      was !== undefined &&
      status !== undefined &&
      isPendingCheck(was) &&
      !isPendingCheck(status)
    ) {
      void queryClient.invalidateQueries({ queryKey: routeRidesKeys.list(routeId) });
    }
  }, [status, queryClient, routeId]);

  return query;
}

/**
 * Свой трек заезда (как `useMyAttemptTrack`): ключ — с ревизией проверки (новая ревизия — новый запрос и новая карта);
 * 404 — `null` (карта без трека).
 */
export function useRouteRideTrack(
  routeId: string,
  ride: RouteRideDetail | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: routeRidesKeys.track(
      routeId,
      ride?.id ?? '',
      ride?.status ?? '',
      ride?.checkedAt ?? null,
    ),
    queryFn: async (): Promise<RouteRideTrack | null> => {
      try {
        return await withAccessToken((token) => api.getRouteRideTrack(token, routeId, ride!.id));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    enabled: enabled && ride !== undefined,
  });
}

/**
 * «Проверить заезд» (`201` и `200` одинаково): ответ — в кеш детали (экран результата открывается без GET), список и
 * кандидаты устаревают.
 */
export function useCheckRouteRide(routeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: RouteRideRequest) =>
      withAccessToken((token) => api.checkRouteRide(token, routeId, body)),
    onSuccess: async (ride) => {
      const key = routeRidesKeys.detail(routeId, ride.id);
      // опрос, ушедший до ответа, несёт прежний статус — его ответ не должен затереть этот
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, ride);
      // без ожидания: переход на результат не ждёт перезапроса списка и кандидатов
      void queryClient.invalidateQueries({ queryKey: routeRidesKeys.list(routeId) });
      void queryClient.invalidateQueries({ queryKey: routeRidesKeys.candidates(routeId) });
    },
  });
}
