import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const DISPUTES_QUERY_KEY = ['admin', 'disputes'] as const;

/** Разбор спора (`disputes.read`). */
export const disputeQuery = (id: string) =>
  queryOptions({
    queryKey: [...DISPUTES_QUERY_KEY, 'item', id],
    queryFn: () => api.getDispute(id),
  });
