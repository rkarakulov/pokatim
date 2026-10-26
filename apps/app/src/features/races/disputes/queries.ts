import type {
  DisputeFileRequest,
  DisputeResponseRequest,
  MyRaceDisputes,
} from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { apiErrorCode } from '@/features/auth/error-messages';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { api } from '@/lib/api';

import { ENTRY_POLL_MS, raceEntryKey, raceResultsKey } from '../queries';
import { needsDisputePolling } from './dispute-format';

/*
 * Споры гонки (race-results-06, RC-14): «мои споры» — только вошедшему с заявкой (`withAccessToken`). Опрос — раз в
 * `ENTRY_POLL_MS`, пока есть открытый спор. Мутации инвалидируют споры, участие (D-39 меняет `actions`) и таблицу.
 */

export const raceDisputesKey = (raceId: string) => ['races', 'disputes', raceId] as const;

/** «Мои споры в гонке». Старый API без эндпоинта (404) — `null`: блока и карточек соперника нет. */
export function useMyRaceDisputes(raceId: string, enabled: boolean) {
  return useQuery({
    queryKey: raceDisputesKey(raceId),
    queryFn: async (): Promise<MyRaceDisputes | null> => {
      try {
        return await withAccessToken((token) => api.getMyRaceDisputes(token, raceId));
      } catch (error) {
        if (apiErrorCode(error) === 'NOT_FOUND') return null;
        throw error;
      }
    },
    staleTime: 0,
    refetchInterval: (q) => (needsDisputePolling(q.state.data) ? ENTRY_POLL_MS : false),
    enabled,
  });
}

async function invalidateDisputes(queryClient: QueryClient, raceId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: raceDisputesKey(raceId) }),
    queryClient.invalidateQueries({ queryKey: raceEntryKey(raceId) }),
    queryClient.invalidateQueries({ queryKey: raceResultsKey(raceId) }),
  ]);
}

/** Мутация спора: успех — инвалидация; отказ 409 — споры устарели, перезапрос. */
function useDisputeMutation<V, R>(raceId: string, call: (token: string, body: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: V) => withAccessToken((token) => call(token, body)),
    onSuccess: () => invalidateDisputes(queryClient, raceId),
    onError: (error) => {
      const code = apiErrorCode(error);
      if (code === 'DISPUTE_ACTION_BLOCKED' || code === 'DISPUTE_NOT_FOUND') {
        void queryClient.invalidateQueries({ queryKey: raceDisputesKey(raceId) });
      }
    },
  });
}

/** «Отправить спор». */
export const useFileDispute = (raceId: string) =>
  useDisputeMutation<DisputeFileRequest, unknown>(raceId, (token, body) =>
    api.fileDispute(token, raceId, body),
  );

/** «Отозвать спор». */
export const useWithdrawDispute = (raceId: string) =>
  useDisputeMutation<string, unknown>(raceId, (token, disputeId) =>
    api.withdrawDispute(token, disputeId),
  );

/** «Отправить ответ» участника, чей результат оспорен. */
export const useRespondToDispute = (raceId: string, disputeId: string) =>
  useDisputeMutation<DisputeResponseRequest, unknown>(raceId, (token, body) =>
    api.respondToDispute(token, disputeId, body),
  );
