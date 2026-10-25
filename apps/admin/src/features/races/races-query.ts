import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const RACES_QUERY_KEY = ['admin', 'races'] as const;

/** Карточка гонки панели (с `editable` сервера). */
export const raceQuery = (id: string) =>
  queryOptions({ queryKey: [...RACES_QUERY_KEY, 'item', id], queryFn: () => api.getRace(id) });
