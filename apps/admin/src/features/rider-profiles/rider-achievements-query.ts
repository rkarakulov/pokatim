import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const RIDER_ACHIEVEMENTS_QUERY_KEY = ['admin', 'rider-achievements'] as const;

/** Выдачи райдера в панели (achievements-panel, `achievements.manage`) — отдельно от карточки профиля. */
export const riderAchievementsQuery = (userId: string) =>
  queryOptions({
    queryKey: [...RIDER_ACHIEVEMENTS_QUERY_KEY, userId],
    queryFn: () => api.getRiderAchievements(userId),
  });
