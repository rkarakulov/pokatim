import type { DeviceList, DeviceProvider, TrackUploadPage } from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { apiErrorCode } from '@/features/auth/error-messages';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { api } from '@/lib/api';

import { connectDevice } from './connect-flow';
import { isUploadInProgress } from './format';
import type { ConnectOrigin } from './return-params';

/** Ключи «Устройств»: при выходе кеш стирается целиком (`queryClient.clear()` корневого layout). */
export const devicesKeys = {
  list: ['devices', 'list'] as const,
  uploads: ['tracks', 'uploads', { limit: 20 }] as const,
};

/** Последние загрузки экрана «Устройства» (Q-рамки: 20 без пагинации). */
const RECENT_UPLOADS = { limit: 20 } as const;
/** Опрос статуса обработки — только пока есть незавершённые загрузки (`pokatim-app.md`: polling, не сокеты). */
export const UPLOAD_POLL_MS = 3000;

const EMPTY_DEVICES: DeviceList = { items: [] };

/**
 * Провайдеры и подключения пользователя. Сервер без агрегатора (`DEVICES_ENABLED=false`) отвечает `404` — это не
 * ошибка экрана, а «подключение недоступно»: пустой список (ручная загрузка работает).
 */
export function useDevices() {
  return useQuery({
    queryKey: devicesKeys.list,
    queryFn: async () => {
      try {
        return await withAccessToken((token) => api.listDevices(token));
      } catch (error) {
        if (apiErrorCode(error) === 'NOT_FOUND') return EMPTY_DEVICES;
        throw error;
      }
    },
  });
}

/** Последние 20 загрузок; пока какая-то обрабатывается — опрос раз в 3 с, затем опрос останавливается. */
export function useTrackUploads() {
  return useQuery({
    queryKey: devicesKeys.uploads,
    queryFn: () => withAccessToken((token) => api.listTrackUploads(token, RECENT_UPLOADS)),
    refetchInterval: (query) =>
      query.state.data?.items.some(isUploadInProgress) ? UPLOAD_POLL_MS : false,
  });
}

/** Ответ действия с подключением (`complete`, `sync`, `disconnect`) — новый список провайдеров. */
function useApplyDevices() {
  const queryClient = useQueryClient();
  return (devices: DeviceList) => queryClient.setQueryData(devicesKeys.list, devices);
}

/** «Подключить» / «Подключить снова»: native — до возврата из браузера, web — до перехода страницы. */
export function useConnectDevice(origin: ConnectOrigin) {
  const queryClient = useQueryClient();
  const apply = useApplyDevices();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (provider: DeviceProvider) => connectDevice(provider, origin),
    onSuccess: (result) => {
      if (result.kind === 'connected') apply(result.devices);
      // браузер закрыли без возврата (или страница ошибки агрегатора) — подключение могло остаться `pending`
      if (result.kind === 'closed')
        void queryClient.invalidateQueries({ queryKey: devicesKeys.list });
    },
  });
}

/** Завершение подключения тикетом возврата (`devices/return`). */
export function useCompleteDevice() {
  const apply = useApplyDevices();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: ({ provider, ticket }: { provider: DeviceProvider; ticket: string }) =>
      withAccessToken((token) => api.completeDevice(token, provider, { ticket })),
    onSuccess: apply,
  });
}

/** «Синхронизировать сейчас» (сервер: не чаще раза в 10 минут — иначе 429 с `retryAfterSec`). */
export function useSyncDevice() {
  const apply = useApplyDevices();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (provider: DeviceProvider) =>
      withAccessToken((token) => api.syncDevice(token, provider)),
    onSuccess: apply,
  });
}

/** «Отключить»; `deleteActivities` — галочка «Удалить заезды из …» (по умолчанию выключена). */
export function useDisconnectDevice() {
  const queryClient = useQueryClient();
  const apply = useApplyDevices();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: ({
      provider,
      deleteActivities,
    }: {
      provider: DeviceProvider;
      deleteActivities: boolean;
    }) => withAccessToken((token) => api.disconnectDevice(token, provider, { deleteActivities })),
    onSuccess: (devices, { deleteActivities }) => {
      apply(devices);
      if (deleteActivities) void queryClient.invalidateQueries({ queryKey: devicesKeys.uploads });
    },
  });
}

/** «Удалить» загрузку вместе с заездом: строка уходит из списка сразу после ответа. */
export function useDeleteTrackUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (id: string) => withAccessToken((token) => api.deleteTrackUpload(token, id)),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<TrackUploadPage>(devicesKeys.uploads, (page) =>
        page ? { ...page, items: page.items.filter((item) => item.id !== id) } : page,
      );
      void queryClient.invalidateQueries({ queryKey: devicesKeys.uploads });
    },
  });
}
