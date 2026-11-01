import type {
  RouteRideDetail,
  RouteRideLeaderboard,
  RouteRidePage,
  RouteRideRequest,
  RouteRideTrack,
} from '@pokatim/contracts';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
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
  // таблица «Другие» (route-rides-04): блок карточки и полный список — разные `limit`
  leaderboardAll: (routeId: string) => ['route-rides', routeId, 'leaderboard'] as const,
  leaderboard: (routeId: string, limit: number) =>
    ['route-rides', routeId, 'leaderboard', limit] as const,
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
 * Интервал опроса незавершённой проверки (RC-6): 3 с первые 2 мин от первого показа, затем 15 с; проверка завершилась
 * — опроса нет и отсчёт сбрасывается. Состояние — на экземпляр запроса (ref владельца).
 */
function useCheckPollInterval() {
  const pendingSince = useRef<number | null>(null);
  return (pending: boolean): number | false => {
    if (!pending) {
      pendingSince.current = null;
      return false;
    }
    pendingSince.current ??= Date.now();
    return Date.now() - pendingSince.current < ROUTE_RIDE_FAST_POLL_FOR_MS
      ? ROUTE_RIDE_POLL_MS
      : ROUTE_RIDE_SLOW_POLL_MS;
  };
}

/**
 * Свои заезды по маршруту: 404 (маршрут стал невидим) — `null` (блока нет); опрос, пока есть строки `queued | checking`
 * (RC-5), по схеме RC-6 и только пока карточка в фокусе (под экраном результата в стеке — нет: результат сам
 * инвалидирует список на финальном статусе).
 */
export function useRouteRides(routeId: string, enabled: boolean) {
  const pollInterval = useCheckPollInterval();
  const focused = useIsFocused();
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
      pollInterval(query.state.data?.items.some((row) => isPendingCheck(row.status)) ?? false),
    // экран не в фокусе — наблюдатель отписан: опроса нет, данные — при возврате
    subscribed: focused,
    enabled,
  });
}

/**
 * Таблица «Другие на маршруте» (route-rides-04, O3): лучшие заезды райдеров с согласием и своя строка — только с
 * сервера (места, `me`, `shared`, имена). 404 (маршрут не каталога, стал невидим, без длины) — `null` (блока нет, RC-B3).
 * Опроса нет: обновление — возврат на экран после `staleTime` (наблюдатель подписан только в фокусе, как у
 * `useRouteRides`), pull-to-refresh и инвалидации (профиль, проверка заезда).
 */
export function useRouteRideLeaderboard(routeId: string, limit: number, enabled: boolean) {
  const focused = useIsFocused();
  return useQuery({
    queryKey: routeRidesKeys.leaderboard(routeId, limit),
    queryFn: async (): Promise<RouteRideLeaderboard | null> => {
      try {
        return await withAccessToken((token) =>
          api.getRouteRideLeaderboard(token, routeId, { limit }),
        );
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    staleTime: DEFAULT_STALE_MS,
    // экран не в фокусе — наблюдатель отписан; возврат после `staleTime` — перезапрос
    subscribed: focused,
    enabled,
  });
}

/** Все таблицы «Другие» (любой маршрут и `limit`) устарели: после `PATCH` профиля сменились `shared` и своё имя (RC-B6). */
export const invalidateRouteRideLeaderboards = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === 'route-rides' && queryKey[2] === 'leaderboard',
  });

/** Кандидаты «Выбрать свой заезд» («Проверить снова» шлёт `activityId` детали, route-rides-03). */
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
 * карточки (RC-5) и таблица «Другие» (route-rides-04, RC-B6) устарели.
 */
export function useRouteRide(routeId: string, rideId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const pollInterval = useCheckPollInterval();
  const query = useQuery({
    queryKey: routeRidesKeys.detail(routeId, rideId),
    queryFn: () => withAccessToken((token) => api.getRouteRide(token, routeId, rideId)),
    staleTime: DEFAULT_STALE_MS,
    refetchInterval: (q) =>
      pollInterval(
        q.state.data !== undefined &&
          isPendingCheck(q.state.data.status) &&
          !isNotFound(q.state.error),
      ),
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
      void queryClient.invalidateQueries({ queryKey: routeRidesKeys.leaderboardAll(routeId) });
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
 * «Проверить заезд» (`201` и `200` одинаково): ответ — в кеш детали (экран результата открывается без GET), список,
 * кандидаты и таблица «Другие» устаревают.
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
      void queryClient.invalidateQueries({ queryKey: routeRidesKeys.leaderboardAll(routeId) });
    },
  });
}

/**
 * «Удалить заезд» (route-rides-07): `404` (уже удалён) — тоже успех. Список, кандидаты и «Другие» маршрута устаревают
 * (лучшие и участки сервер считает на чтении); деталь и трек не перезапрашиваются (заезда нет) — экран после ухода
 * убирает их `forgetRouteRide` (раньше — открытый экран перезапросил бы деталь и мигнул «Заезд не найден»).
 */
export function useDeleteRouteRide(routeId: string, rideId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: async () => {
      try {
        await withAccessToken((token) => api.deleteRouteRide(token, routeId, rideId));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: routeRidesKeys.all(routeId),
        predicate: ({ queryKey }) =>
          !(queryKey[3] === rideId && ['ride', 'track'].includes(String(queryKey[2]))),
      }),
  });
}

/** Деталь и трек удалённого заезда — из кеша (после ухода с экрана заезда). */
export function forgetRouteRide(queryClient: QueryClient, routeId: string, rideId: string) {
  queryClient.removeQueries({ queryKey: routeRidesKeys.detail(routeId, rideId) });
  queryClient.removeQueries({ queryKey: [...routeRidesKeys.all(routeId), 'track', rideId] });
}
