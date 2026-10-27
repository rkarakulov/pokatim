import type { NotificationPage, NotificationSettings } from '@pokatim/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

/**
 * Центр уведомлений (ADR-0017): всё — только вошедшему через `withAccessToken`, сервер отдаёт `no-store`. Счётчик
 * колокольчика — polling раз в 60 с (реального времени нет, N9); мутации прочтения и настроек инвалидируют
 * `['notifications']` (список и счётчик).
 */

const PAGE_LIMIT = 20;
/** Опрос счётчика непрочитанных (N9): реального времени нет — polling. */
export const UNREAD_POLL_MS = 60_000;

export const notificationsKey = ['notifications'] as const;
export const unreadCountKey = ['notifications', 'unread'] as const;
const listKey = ['notifications', 'list', 'pages'] as const;
const settingsKey = ['notifications', 'settings'] as const;

/** Счётчик колокольчика: только у вошедшего, опрос 60 с и при возврате фокуса. */
export function useUnreadCount() {
  const signedIn = useSessionStore((state) => isSignedIn(state));
  return useQuery({
    queryKey: unreadCountKey,
    queryFn: () => withAccessToken((accessToken) => api.getUnreadCount(accessToken)),
    refetchInterval: UNREAD_POLL_MS,
    staleTime: DEFAULT_STALE_MS,
    enabled: signedIn,
  });
}

const nextCursor = (page: NotificationPage) => page.nextCursor ?? undefined;

/** Список центра (новые сверху), страницы по курсору; подгрузка у конца — `loadMore`. */
export function useNotifications() {
  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) =>
      withAccessToken((accessToken) =>
        api.listNotifications(accessToken, {
          limit: PAGE_LIMIT,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursor,
    staleTime: DEFAULT_STALE_MS,
  });
  const loadMore = () => {
    if (list.hasNextPage && !list.isFetching && !list.isFetchNextPageError) {
      void list.fetchNextPage({ cancelRefetch: false });
    }
  };
  return { list, loadMore };
}

/** Нажатие на уведомление (N9): прочитано → список и счётчик устаревают. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      withAccessToken((accessToken) => api.markNotificationRead(accessToken, id)),
    networkMode: 'always',
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });
}

/** «Прочитать все». */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withAccessToken((accessToken) => api.markAllNotificationsRead(accessToken)),
    networkMode: 'always',
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationsKey }),
  });
}

/** Настройки (N4, N6): нет документа на сервере — умолчания сервера. */
export function useNotificationSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => withAccessToken((accessToken) => api.getNotificationSettings(accessToken)),
    staleTime: DEFAULT_STALE_MS,
  });
}

/** Сохранение полного объекта настроек; ответ сервера — в кеш. */
export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: NotificationSettings) =>
      withAccessToken((accessToken) => api.updateNotificationSettings(accessToken, settings)),
    networkMode: 'always',
    onSuccess: (saved) => queryClient.setQueryData(settingsKey, saved),
  });
}
