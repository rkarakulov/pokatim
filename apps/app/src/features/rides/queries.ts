import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  RideQuotaDetails,
  type CancelRideRequest,
  type CreateRideReportRequest,
  type CreateRideRequest,
  type RideDetail,
  type RidePage,
  type RideView,
  type UpdateRideRequest,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { retryAfterSec } from '@/features/auth/error-messages';
import {
  closePushSoftPromptFor,
  offerPushSoftPrompt,
} from '@/features/notifications/push-soft-prompt-store';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

import type { RideFilters } from './filters';
import { NEAR_RADIUS_KM, nearParam, type NearQuery } from './near';

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
 * Параметры «Рядом» запроса — только в `queryFn` (замыкание): в ключе — счётчик нажатия `near.seq` (RC-7, ADR-0014
 * поправка 05c), координаты — нет.
 */
const nearParams = (near: NearQuery | null) =>
  near ? { near: nearParam(near.lngLat), radiusKm: NEAR_RADIUS_KM } : {};

/**
 * Страницы ленты вкладки: ключ `['rides','list',{ city, limit, near: seq | null },'pages']` — форма `InfiniteData`,
 * префикс общий с Главной (`['rides','list',{ limit: 1 }]`). «Рядом» (05c) — в ключе только счётчик нажатия, позиция —
 * в замыкании запроса. Подгрузка у конца — `loadMore` (не во время обновления).
 */
export function useRideFeed(filters: RideFilters, near: NearQuery | null = null, enabled = true) {
  const params = { city: filters.city, limit: PAGE_LIMIT, near: near?.seq ?? null };
  const feed = useInfiniteQuery({
    queryKey: ['rides', 'list', params, 'pages'],
    queryFn: ({ pageParam }) =>
      withAccessToken((accessToken) =>
        api.listRides(accessToken, {
          city: [...filters.city],
          limit: PAGE_LIMIT,
          ...nearParams(near),
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: FEED_STALE_MS,
    enabled,
  });
  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError) {
      void feed.fetchNextPage({ cancelRefetch: false });
    }
  };
  // сервер отбирает пачками: пустая страница с курсором — не конец (ревью pass 1). Пустая последняя — дочитываем
  // сразу (контент не растёт, `onEndReached` не придёт), но не больше `EMPTY_PAGES_MAX` подряд — дальше «Показать ещё»
  const emptyTail = trailingEmptyPages(feed.data?.pages);
  const stalled = feed.hasNextPage && emptyTail >= EMPTY_PAGES_MAX;
  const autoContinue =
    enabled &&
    emptyTail > 0 &&
    !stalled &&
    feed.hasNextPage &&
    !feed.isFetching &&
    !feed.isFetchNextPageError;
  const fetchNextPage = feed.fetchNextPage;
  // `emptyTail` в зависимостях: новая пустая страница может прийти без промежуточного рендера с `isFetching`
  useEffect(() => {
    if (autoContinue) void fetchNextPage({ cancelRefetch: false });
  }, [autoContinue, emptyTail, fetchNextPage]);
  /** Райдов ещё нет, но выдача не кончилась: дочитываем (скелетон) или стоим на пределе («Показать ещё»). */
  const scanning =
    feed.data !== undefined && emptyTail === feed.data.pages.length && feed.hasNextPage;
  return { feed, loadMore, stalled, scanning };
}

/** Пустых страниц подряд, после которых дочитывание ждёт нажатия «Показать ещё». */
export const EMPTY_PAGES_MAX = 5;

const trailingEmptyPages = (pages: readonly RidePage[] | undefined) => {
  let count = 0;
  for (let index = (pages?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (pages![index]!.items.length > 0) break;
    count += 1;
  }
  return count;
};

/**
 * Карта ленты (05c): точки старта будущих райдов с видимым маршрутом; ключ `['rides','map',{ city, near: seq | null }]`
 * (без координат), запрос — только в режиме «Карта» (`enabled`).
 */
export function useRideMap(filters: RideFilters, near: NearQuery | null, enabled: boolean) {
  return useQuery({
    queryKey: ['rides', 'map', { city: filters.city, near: near?.seq ?? null }],
    queryFn: () =>
      withAccessToken((accessToken) =>
        api.listRideMap(accessToken, { city: [...filters.city], ...nearParams(near) }),
      ),
    staleTime: FEED_STALE_MS,
    enabled,
  });
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

/**
 * Состояние зрителя (только вошедшим). `manage` — экраны правки и отмены: без фонового обновления (фокус, сеть) —
 * форма держит `version` загрузки, свежие данные — только явным «Обновить».
 */
export function useRideForViewer(id: string, enabled: boolean, { manage = false } = {}) {
  return useQuery({
    queryKey: rideViewerKey(id),
    queryFn: () => withAccessToken((accessToken) => api.getRideForViewer(accessToken, id)),
    staleTime: manage ? Infinity : DEFAULT_STALE_MS,
    refetchOnWindowFocus: !manage,
    refetchOnReconnect: !manage,
    enabled,
  });
}

/** Ответ мутации — в кеш `me`, затем всё `['rides']` устаревает (лента, Главная, города, карточка). */
async function applyRideView(queryClient: QueryClient, view: RideView): Promise<void> {
  queryClient.setQueryData(rideViewerKey(view.ride.id), view);
  await queryClient.invalidateQueries({ queryKey: ridesKey });
}

/**
 * «Я иду» / «Не иду» одного райда: кнопка выключена на время запроса, ошибка — текст у действия. Успех «Я иду» —
 * подсказка push (N5), «Не иду» — её закрытие; здесь, а не в `mutate`: место кнопки может размонтироваться до ответа.
 */
export function useRideRsvp(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: 'join' | 'leave') =>
      withAccessToken((accessToken) =>
        action === 'join' ? api.joinRide(accessToken, id) : api.leaveRide(accessToken, id),
      ),
    networkMode: 'always',
    onSuccess: (view, action) => {
      if (action === 'join') offerPushSoftPrompt('ride', id);
      else closePushSoftPromptFor('ride', id);
      return applyRideView(queryClient, view);
    },
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

/**
 * Фото организатора (ride-photo, ADR-0028): `PUT /v1/rides/:id/photo` сырыми байтами (как аватар — `fetch` с Blob на
 * всех платформах). Ответ `RideView` → кеш `me` и инвалидация `['rides']`: лента, Главная, деталь и статус карточек
 * приглашения (`['rides','invite',…]` — новый токен `night` с фото).
 */
export function useUploadRidePhoto(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Blob) =>
      withAccessToken((accessToken) => api.uploadRidePhoto(accessToken, id, body)),
    networkMode: 'always',
    onSuccess: (view) => applyRideView(queryClient, view),
  });
}

/** Удаление фото своего райда (идемпотентно, `POST /v1/rides/:id/photo/delete`) — так же в кеш и инвалидация. */
export function useDeleteRidePhoto(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withAccessToken((accessToken) => api.deleteRidePhoto(accessToken, id)),
    networkMode: 'always',
    onSuccess: (view) => applyRideView(queryClient, view),
  });
}

/** Жалоба (05b): ответ — `viewer.reported`, кеш `me` и инвалидация, как у других мутаций. */
export function useReportRide(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRideReportRequest) =>
      withAccessToken((accessToken) => api.reportRide(accessToken, id, body)),
    networkMode: 'always',
    onSuccess: (view) => applyRideView(queryClient, view),
  });
}

/** Текст отказа жалобы: райда нет (удалён или скрыт) — «Райд не найден»; остальное — как у действий. */
export function rideReportErrorText(error: unknown): string {
  if (apiErrorOf(error)?.code === 'NOT_FOUND') return t('rides.detail.notFound');
  return rideActionErrorText(error, null);
}

/** Текст отказа действия с райдом (баннер у кнопки): мест нет, начался/отменён, 429, сеть. */
export function rideActionErrorText(error: unknown, limit: number | null): string {
  if (isNetworkError(error)) return t('rides.error.network');
  const code = apiErrorOf(error)?.code;
  if (code === 'RIDE_FULL') {
    return limit === null ? t('rides.error.fullNoLimit') : t('rides.error.full', { limit });
  }
  if (code === 'RIDE_INVALID_STATE') return t('rides.error.invalidState');
  if (code === 'RIDE_QUOTA_EXCEEDED') {
    // «Я иду» сверх квоты будущих отметок
    const details = RideQuotaDetails.safeParse(apiErrorOf(error)?.details);
    return t('rides.error.quotaJoined', { count: details.success ? details.data.limit : 20 });
  }
  if (code === 'RATE_LIMITED') {
    return t('rides.error.rateLimited', { seconds: retryAfterSec(error) ?? 60 });
  }
  return t('rides.error.unknown');
}
