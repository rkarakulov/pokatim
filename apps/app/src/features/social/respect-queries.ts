import { apiErrorOf } from '@pokatim/api-client';
import type { RespectState } from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

/**
 * «Респект» (P4, K8): состояние зрителя — только вошедшему (`withAccessToken`, сервер — `no-store`), под префиксом
 * `['social']` (стирается при выходе вместе с «Своими»). `PUT` — ответ в кэш; 404 (цель исчезла) — перечитать.
 */
export const raceEntryRespectKey = (raceId: string, entryId: string) =>
  ['social', 'respect', 'race_entry', raceId, entryId] as const;
export const routeRespectKey = (routeId: string) =>
  ['social', 'respect', 'route', routeId] as const;

export function useRaceEntryRespect(raceId: string, entryId: string, enabled: boolean) {
  return useQuery({
    queryKey: raceEntryRespectKey(raceId, entryId),
    queryFn: () => withAccessToken((token) => api.getRaceEntryRespect(token, raceId, entryId)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

export function useRouteRespect(routeId: string, enabled: boolean) {
  return useQuery({
    queryKey: routeRespectKey(routeId),
    queryFn: () => withAccessToken((token) => api.getRouteRespect(token, routeId)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

function useSetRespect(
  key: readonly unknown[],
  put: (token: string, respected: boolean) => Promise<RespectState>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (respected: boolean) => withAccessToken((token) => put(token, respected)),
    onSuccess: (state) => {
      queryClient.setQueryData(key, state);
    },
    onError: (error) => {
      if (apiErrorOf(error)?.code === 'NOT_FOUND') {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useSetRaceEntryRespect(raceId: string, entryId: string) {
  return useSetRespect(raceEntryRespectKey(raceId, entryId), (token, respected) =>
    api.setRaceEntryRespect(token, raceId, entryId, { respected }),
  );
}

export function useSetRouteRespect(routeId: string) {
  return useSetRespect(routeRespectKey(routeId), (token, respected) =>
    api.setRouteRespect(token, routeId, { respected }),
  );
}
