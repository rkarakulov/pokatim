import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const DISPUTES_QUERY_KEY = ['admin', 'disputes'] as const;

/** Разбор спора (`disputes.read`). */
export const disputeQuery = (id: string) =>
  queryOptions({
    queryKey: [...DISPUTES_QUERY_KEY, 'item', id],
    queryFn: () => api.getDispute(id),
  });

/**
 * Ряды пульса и мощности оспоренного результата (06b, `disputes.read`): биометрия не держится в кэше клиента после
 * ухода с экрана (`gcTime: 0`) и не перезапрашивается фокусом окна. Опрос «готовится» — в `DisputeSeries`.
 */
export const disputeSeriesQuery = (id: string) =>
  queryOptions({
    queryKey: [...DISPUTES_QUERY_KEY, 'series', id],
    queryFn: () => api.getDisputeSeries(id),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
