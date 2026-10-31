import type { AppThemeId, ProfileView } from '@pokatim/contracts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { PROFILE_QUERY_KEY } from '@/features/home/queries';
import { invalidateCardStatuses } from '@/features/sharing/card-status';
import { api } from '@/lib/api';

/** Смены темы идут по очереди (TanStack Query: мутации одного scope последовательны). */
const SCOPE = 'profile-theme';

/**
 * Смены темы в полёте, включая текущую: в `onMutate`, `onSuccess` и `onError` своя мутация ещё `pending` — больше
 * одной значит, что в очереди есть другие (итог определяет последняя).
 */
const pendingThemeChanges = (queryClient: QueryClient) =>
  queryClient
    .getMutationCache()
    .findAll({ status: 'pending', predicate: (m) => m.options.scope?.id === SCOPE }).length;

const withTheme = (themeId: ProfileView['themeId']) => (profile: ProfileView | undefined) =>
  profile && { ...profile, themeId };

/**
 * Смена личной темы (user-theme A10, `PUT /v1/profile/theme`): сразу — в кэш профиля (корень перекрашивается
 * оптимистично), ответ — полный профиль в `['profile']` без префиксной инвалидации. Ошибка — откат к теме, которую
 * последней подтвердил сервер (экран показывает баннер). Успех перезапрашивает статусы карточек для сторис. Быстрые повторные выборы: запросы идут по очереди, итог —
 * последнего выбора; ответ или ошибка ранней смены, пока поздняя в полёте, отметку не перекрашивают.
 */
export function useSetTheme() {
  const queryClient = useQueryClient();
  // тема, подтверждённая сервером (до первой смены — из кэша профиля)
  const confirmed = useRef<ProfileView['themeId'] | undefined>(undefined);
  return useMutation({
    mutationFn: (themeId: AppThemeId) =>
      withAccessToken((accessToken) => api.setProfileTheme(accessToken, { themeId })),
    networkMode: 'always',
    scope: { id: SCOPE },
    onMutate: async (themeId) => {
      // считаем до `await`: смены, ставшие `pending` в том же окне, иначе обе видели бы себя не первыми
      const first = pendingThemeChanges(queryClient) <= 1;
      await queryClient.cancelQueries({ queryKey: PROFILE_QUERY_KEY, exact: true });
      const current = queryClient.getQueryData<ProfileView>(PROFILE_QUERY_KEY);
      // первая смена в очереди — кэш ещё равен подтверждённому
      if (first) confirmed.current = current?.themeId;
      queryClient.setQueryData<ProfileView | undefined>(PROFILE_QUERY_KEY, withTheme(themeId));
    },
    onSuccess: (view) => {
      confirmed.current = view.themeId;
      // карточки сервер рисует в теме профиля: запрошенные до сохранения — прежней темы
      void invalidateCardStatuses(queryClient);
      // ответ пришёл после выхода (`queryClient.clear()`): профиль прошлого аккаунта в кэш не возвращаем
      if (!queryClient.getQueryData(PROFILE_QUERY_KEY)) return;
      if (pendingThemeChanges(queryClient) > 1) {
        // поздняя смена в полёте: свежий профиль, но тема — её оптимистичная
        const optimistic = queryClient.getQueryData<ProfileView>(PROFILE_QUERY_KEY)?.themeId;
        queryClient.setQueryData(
          PROFILE_QUERY_KEY,
          optimistic ? { ...view, themeId: optimistic } : view,
        );
        return;
      }
      queryClient.setQueryData(PROFILE_QUERY_KEY, view);
    },
    onError: () => {
      if (pendingThemeChanges(queryClient) > 1 || confirmed.current === undefined) return;
      queryClient.setQueryData<ProfileView | undefined>(
        PROFILE_QUERY_KEY,
        withTheme(confirmed.current),
      );
    },
  });
}
