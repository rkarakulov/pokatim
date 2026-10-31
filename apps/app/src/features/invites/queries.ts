import { useQuery } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

/** Ключ личного кода приглашения; стирается при выходе вместе со всем кэшем (`queryClient.clear()`). */
export const INVITE_CODE_KEY = ['social', 'invite-code'] as const;

/** Личный код приглашения вошедшего (`GET /v1/social/invite-code`, P6): код не меняется — без перезапросов. */
export function useOwnInviteCode() {
  const signedIn = useSessionStore((state) => isSignedIn(state));
  return useQuery({
    queryKey: INVITE_CODE_KEY,
    queryFn: () => withAccessToken((accessToken) => api.getInviteCode(accessToken)),
    enabled: signedIn,
    staleTime: Infinity,
  });
}
