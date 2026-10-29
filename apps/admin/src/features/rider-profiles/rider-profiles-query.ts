import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const RIDER_PROFILES_QUERY_KEY = ['admin', 'rider-profiles'] as const;

/** Карточка модерации профиля (жалобы и `reportRevision` для «Отклонить жалобы»). */
export const riderProfileQuery = (userId: string) =>
  queryOptions({
    queryKey: [...RIDER_PROFILES_QUERY_KEY, 'item', userId],
    queryFn: () => api.getRiderProfile(userId),
  });
