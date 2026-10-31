import { ApiHttpError } from '@pokatim/api-client';
import {
  isSeasonalCode,
  type AchievementCode,
  type AchievementList,
  type SeasonalAchievementRef,
} from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';

import { achievementKey, type SeenTarget } from './achievement-catalog';

/**
 * Свои достижения (`GET /v1/achievements`, `no-store`; сервер сверяет выдачи при каждом запросе — RC-12): один ключ на
 * хост вспышки, блок «Профиля» и экран достижения. Перезапрос — на старте и при возврате приложения (`focusManager`),
 * не чаще `staleTime`; кэш стирается при выходе (`queryClient.clear()`).
 */
export const ACHIEVEMENTS_KEY = ['achievements'] as const;
export const ACHIEVEMENTS_STALE_MS = 60_000;

export function useAchievements(enabled = true) {
  return useQuery({
    queryKey: ACHIEVEMENTS_KEY,
    queryFn: () => withAccessToken((accessToken) => api.listAchievements(accessToken)),
    staleTime: ACHIEVEMENTS_STALE_MS,
    enabled,
  });
}

const targetKey = (target: SeenTarget) =>
  target.seasonId === null ? target.code : `${target.code}:${target.seasonId}`;

/**
 * Пометить показанные (`POST /v1/achievements/seen`, 204) по адресам `SeenTarget` (сезонные — код и сезон): оптимистично
 * `seen: true` в кэше по `achievementKey`; ошибка — откат только своих адресов (параллельная пометка других не
 * теряется). Повтор после отката не зацикливает вспышку: показанные в этом запуске исключает `flash-session`.
 */
export function useMarkAchievementsSeen() {
  const queryClient = useQueryClient();
  // время ответа сервера не меняется: по нему `flash-session` отличает новый ответ от правки кэша
  const setSeen = (keys: ReadonlySet<string>, seen: boolean) =>
    queryClient.setQueryData<AchievementList>(
      ACHIEVEMENTS_KEY,
      (list) =>
        list
          ? {
              // `progress` не теряется: блок «Следующие цели» не исчезает после вспышки (RC-L3)
              ...list,
              items: list.items.map((item) =>
                keys.has(achievementKey(item)) ? { ...item, seen } : item,
              ),
            }
          : list,
      { updatedAt: queryClient.getQueryState(ACHIEVEMENTS_KEY)?.dataUpdatedAt },
    );
  return useMutation({
    mutationFn: (targets: readonly SeenTarget[]) => {
      const codes: AchievementCode[] = [];
      const seasonal: SeasonalAchievementRef[] = [];
      for (const { code, seasonId } of targets) {
        if (seasonId !== null && isSeasonalCode(code)) seasonal.push({ code, seasonId });
        else codes.push(code);
      }
      return withAccessToken((accessToken) =>
        api.markAchievementsSeen(accessToken, codes, seasonal),
      );
    },
    onMutate: async (targets) => {
      await queryClient.cancelQueries({ queryKey: ACHIEVEMENTS_KEY });
      const unseen = new Set(
        queryClient
          .getQueryData<AchievementList>(ACHIEVEMENTS_KEY)
          ?.items.filter((item) => !item.seen)
          .map(achievementKey),
      );
      const keys = targets.map(targetKey);
      setSeen(new Set(keys), true);
      return { reverted: new Set(keys.filter((key) => unseen.has(key))) };
    },
    onError: (_error, _codes, context) => {
      if (context && context.reverted.size > 0) setSeen(context.reverted, false);
    },
  });
}

/**
 * Публичные гоночные и сезонные достижения райдера (`GET /v1/riders/:publicId/achievements`, `public, max-age=60`): только клиент
 * (RC-5) и только после найденного профиля. Под префиксом `['riders']` — инвалидация мутаций своего профиля.
 */
export const riderAchievementsKey = (id: string) => ['riders', 'achievements', id] as const;

export function useRiderAchievements(id: string, enabled: boolean) {
  return useQuery({
    queryKey: riderAchievementsKey(id),
    queryFn: () => api.getRiderAchievements(id),
    staleTime: ACHIEVEMENTS_STALE_MS,
    enabled,
  });
}

/** 404 публичного списка — профиль скрыли между запросами: блоку нечего показывать. */
export const isNotFound = (error: unknown) => error instanceof ApiHttpError && error.status === 404;
