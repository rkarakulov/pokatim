import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import type {
  CancelRideRequest,
  CreateRideRequest,
  RideDetail,
  RidePage,
  RideView,
  UpdateRideRequest,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { retryAfterSec } from '@/features/auth/error-messages';
import { api } from '@/lib/api';

import type { RideFilters } from './filters';

/**
 * Данные кофе-райдов. Лента, города и `me` зависят от зрителя (роль, отменённые свои) — только через
 * `withAccessToken`, сервер отдаёт `no-store`; публичная карточка — без входа (`public, max-age=60`). Мутации
 * (`networkMode: 'always'`): ответ `RideView` → кеш `me`, затем инвалидация `['rides']` (лента, Главная, города,
 * карточка).
 */

const PAGE_LIMIT = 20;
/** Данные зрителя меняются (роль, места) — дольше 30 с не держим; без polling. */
const FEED_STALE_MS = 30_000;
const PUBLIC_STALE_MS = 60_000;

export const ridesKey = ['rides'] as const;
export const rideDetailKey = (id: string) => ['rides', 'detail', id] as const;
export const rideViewerKey = (id: string) => ['rides', 'detail', id, 'me'] as const;
const NEXT_RIDE = { limit: 1 } as const;

const nextCursor = (page: RidePage) => page.nextCursor ?? undefined;

/**
 * Страницы ленты вкладки: ключ `['rides','list',{ city, limit },'pages']` — форма `InfiniteData`, префикс общий с
 * Главной (`['rides','list',{ limit: 1 }]`). Подгрузка у конца — `loadMore` (не во время обновления).
 */
export function useRideFeed(filters: RideFilters) {
  const params = { city: filters.city, limit: PAGE_LIMIT };
  const feed = useInfiniteQuery({
    queryKey: ['rides', 'list', params, 'pages'],
    queryFn: ({ pageParam }) =>
      withAccessToken((accessToken) =>
        api.listRides(accessToken, {
          city: [...filters.city],
          limit: PAGE_LIMIT,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: FEED_STALE_MS,
  });
  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) {
      void feed.fetchNextPage({ cancelRefetch: false });
    }
  };
  return { feed, loadMore };
}

/** Города с видимыми будущими райдами — чипы «Город». */
export function useRideCities() {
  return useQuery({
    queryKey: ['rides', 'cities'],
    queryFn: () => withAccessToken((accessToken) => api.listRideCities(accessToken)),
    staleTime: FEED_STALE_MS,
  });
}

/** Ближайший райд для Главной (тот же эндпоинт, `limit: 1`). */
export function useNextRide() {
  return useQuery({
    queryKey: ['rides', 'list', NEXT_RIDE],
    queryFn: () => withAccessToken((accessToken) => api.listRides(accessToken, NEXT_RIDE)),
    staleTime: FEED_STALE_MS,
  });
}

/** Публичная карточка: посев SSR (`initialData`) — только web; 404 — `ApiHttpError`. */
export function useRide(id: string, seed: RideDetail | undefined, enabled: boolean) {
  return useQuery({
    queryKey: rideDetailKey(id),
    queryFn: () => api.getRide(id),
    initialData: seed,
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/** Состояние зрителя (только вошедшим). */
export function useRideForViewer(id: string, enabled: boolean) {
  return useQuery({
    queryKey: rideViewerKey(id),
    queryFn: () => withAccessToken((accessToken) => api.getRideForViewer(accessToken, id)),
    staleTime: 0,
    enabled,
  });
}

/** Ответ мутации — в кеш `me`, затем всё `['rides']` устаревает (лента, Главная, города, карточка). */
async function applyRideView(queryClient: QueryClient, view: RideView): Promise<void> {
  queryClient.setQueryData(rideViewerKey(view.ride.id), view);
  await queryClient.invalidateQueries({ queryKey: ridesKey });
}

/** «Я иду» / «Не иду» одного райда: кнопка выключена на время запроса, ошибка — текст у действия. */
export function useRideRsvp(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'join' | 'leave') =>
      withAccessToken((accessToken) =>
        action === 'join' ? api.joinRide(accessToken, id) : api.leaveRide(accessToken, id),
      ),
    networkMode: 'always',
    onSuccess: (view) => applyRideView(queryClient, view),
  });
}

export function useCreateRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRideRequest) =>
      withAccessToken((accessToken) => api.createRide(accessToken, body)),
    networkMode: 'always',
    onSuccess: (view) => applyRideView(queryClient, view),
  });
}

export function useUpdateRide(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateRideRequest) =>
      withAccessToken((accessToken) => api.updateRide(accessToken, id, body)),
    networkMode: 'always',
    onSuccess: (view) => applyRideView(queryClient, view),
  });
}

export function useCancelRide(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CancelRideRequest) =>
      withAccessToken((accessToken) => api.cancelRide(accessToken, id, body)),
    networkMode: 'always',
    onSuccess: (view) => applyRideView(queryClient, view),
  });
}

/** Текст отказа действия с райдом (баннер у кнопки): мест нет, начался/отменён, 429, сеть. */
export function rideActionErrorText(error: unknown, limit: number | null): string {
  if (isNetworkError(error)) return t('rides.error.network');
  const code = apiErrorOf(error)?.code;
  if (code === 'RIDE_FULL') {
    return limit === null ? t('rides.error.fullNoLimit') : t('rides.error.full', { limit });
  }
  if (code === 'RIDE_INVALID_STATE') return t('rides.error.invalidState');
  if (code === 'RATE_LIMITED') {
    return t('rides.error.rateLimited', { seconds: retryAfterSec(error) ?? 60 });
  }
  return t('rides.error.unknown');
}
