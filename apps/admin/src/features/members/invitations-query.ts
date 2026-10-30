import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

export const INVITATIONS_QUERY_KEY = ['admin', 'invitations'] as const;

/** Блок «Приглашения»: живые приглашения (до 200), `expired` — от сервера. */
export const invitationsQuery = queryOptions({
  queryKey: INVITATIONS_QUERY_KEY,
  queryFn: () => api.listInvitations(),
});
