import type { TicketEventKind } from '@pokatim/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '@/lib/api';

/**
 * Публичный список материалов события (plan-C §7, RC-C9): без входа, сервер — `public, max-age=60`. Ключ — вне
 * `['tickets']`: мутации регистрации и участия инвалидируют билеты, материалы от них не зависят.
 */
export const eventMaterialsKey = (kind: TicketEventKind, eventId: string) =>
  ['events', kind, eventId, 'materials'] as const;

const MATERIALS_STALE_MS = 60_000;

export const eventMaterialsQuery = (kind: TicketEventKind, eventId: string) => ({
  queryKey: eventMaterialsKey(kind, eventId),
  queryFn: () => api.getEventMaterials(kind, eventId),
  staleTime: MATERIALS_STALE_MS,
});

/** Материалы карточки гонки или старта; 404 (событие не опубликовано) не повторяется (`shouldRetry` клиента). */
export function useEventMaterials(kind: TicketEventKind, eventId: string, enabled: boolean) {
  return useQuery({ ...eventMaterialsQuery(kind, eventId), enabled });
}

/** Pull-to-refresh карточки: перезапрос материалов, если блок их уже запрашивал. */
export function useEventMaterialsRefetch(kind: TicketEventKind, eventId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.refetchQueries({ queryKey: eventMaterialsKey(kind, eventId) }),
    [queryClient, kind, eventId],
  );
}
