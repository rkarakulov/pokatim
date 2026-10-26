import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const RIDES_MODERATION_QUERY_KEY = ['admin', 'rides-moderation'] as const;

/** Карточка модерации райда (жалобы и `version` для действий). */
export const moderationRideQuery = (id: string) =>
  queryOptions({
    queryKey: [...RIDES_MODERATION_QUERY_KEY, 'item', id],
    queryFn: () => api.getModerationRide(id),
  });
