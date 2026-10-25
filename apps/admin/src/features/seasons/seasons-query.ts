import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const SEASONS_QUERY_KEY = ['admin', 'seasons'] as const;

/** Все сезоны (их десятки) — таблица «Сезоны», фильтр и предпросмотр сезона в форме гонки. */
export const seasonsQuery = queryOptions({
  queryKey: SEASONS_QUERY_KEY,
  queryFn: () => api.listSeasons(),
  select: (list) => list.items,
});
