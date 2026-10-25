import type { PanelMe } from '@pokatim/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { api } from '../api';

export const ME_QUERY_KEY = ['admin', 'me'] as const;

/** «Кто я и что могу»: без повторов (401 — сразу на «Вход»), минута свежести. */
export const meQuery = queryOptions({
  queryKey: ME_QUERY_KEY,
  queryFn: () => api.me(),
  retry: false,
  staleTime: 60_000,
});

/** Текущий сотрудник — внутри защищённой ветки данные уже есть (`beforeLoad`). */
export function useMe(): PanelMe | undefined {
  return useQuery(meQuery).data;
}
