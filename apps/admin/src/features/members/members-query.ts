import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const MEMBERS_QUERY_KEY = ['admin', 'members'] as const;

/** «Сотрудники»: весь список (до 500) — фильтры и сортировка на клиенте. */
export const membersQuery = queryOptions({
  queryKey: MEMBERS_QUERY_KEY,
  queryFn: () => api.listMembers(),
});
