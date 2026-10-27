import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const RIDER_ROUTES_QUERY_KEY = ['admin', 'rider-routes'] as const;

/** Карточка заявки райдера: линия, профиль, жалобы и `version` для действий (routes-06). */
export const riderRouteQuery = (id: string) =>
  queryOptions({
    queryKey: [...RIDER_ROUTES_QUERY_KEY, 'item', id],
    queryFn: () => api.getRiderRoute(id),
  });
