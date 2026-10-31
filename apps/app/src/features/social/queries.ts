import { apiErrorOf } from '@pokatim/api-client';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { fetchProfile, PROFILE_QUERY_KEY } from '@/features/home/queries';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

/**
 * «Свои» (P3, K6): данные зрителя — только вошедшему (`withAccessToken`, сервер — `no-store`); кеш стирается при
 * выходе. Префикс `['social']` инвалидирует уход с экрана «Свои» (обновится «Свои · N»).
 */
export const socialKey = ['social'] as const;
export const riderSocialKey = (publicId: string) => ['social', 'rider', publicId] as const;
export const socialConnectionsKey = ['social', 'connections'] as const;

/**
 * Подсказка K3 нужна: у вошедшего нет публичного профиля (`publicId === null` — сервер отдаёт его только при имени и
 * согласии). Тот же кэш `['profile']`, что порядок разделов Главной, без второго запроса; не пришёл — `undefined`.
 */
export function useNameMissing(enabled: boolean): boolean | undefined {
  const query = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: fetchProfile,
    staleTime: Infinity,
    select: (profile) => profile.publicId === null,
    enabled,
  });
  return enabled ? query.data : undefined;
}

/** «Вместе ехали», «Идёт», «В своих» на чужом профиле — после найденного профиля (как `useRiderViewer`). */
export function useRiderSocial(publicId: string, enabled: boolean) {
  return useQuery({
    queryKey: riderSocialKey(publicId),
    queryFn: () => withAccessToken((token) => api.getRiderSocial(token, publicId)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/** «Свои» вошедшего и «Свои · N» (`count` сервера). */
export function useSocialConnections() {
  return useQuery({
    queryKey: socialConnectionsKey,
    queryFn: () => withAccessToken((token) => api.listSocialConnections(token)),
    staleTime: DEFAULT_STALE_MS,
  });
}

/**
 * «В свои» / «Убрать из своих» (`PUT {connected}`): ответ — свежее состояние зрителя к райдеру
 * (`setQueryData`). `refreshList` — список «Свои» устарел (профиль райдера); экран «Свои» список не перезапрашивает
 * до ухода — строка остаётся.
 */
export function useSetRiderConnection(publicId: string, { refreshList }: { refreshList: boolean }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connected: boolean) =>
      withAccessToken((token) => api.setRiderConnection(token, publicId, { connected })),
    onSuccess: async (view) => {
      queryClient.setQueryData(riderSocialKey(publicId), view);
      if (refreshList) await queryClient.invalidateQueries({ queryKey: socialConnectionsKey });
    },
  });
}

/** Текст отказа «В свои» у кнопки: лимит K11 — свой текст, остальное — общий. */
export function socialActionErrorText(error: unknown): string {
  return apiErrorOf(error)?.code === 'RATE_LIMITED'
    ? t('social.error.RATE_LIMITED')
    : t('social.error.unknown');
}
