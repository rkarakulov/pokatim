import type {
  CalendarRegistrationRequest,
  CalendarRegistrationState,
  TicketView,
} from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { apiErrorCode } from '@/features/auth/error-messages';
import { AUTH_MUTATION } from '@/features/auth/queries';
import { sessionOwner } from '@/features/auth/session-identity';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';
import { DEFAULT_STALE_MS } from '@/lib/query-client';

import { isStaleTicketingError } from './error-messages';
import { removeOfflineTicket, saveOfflineTicket } from './offline-store';

/**
 * Билеты (event-tickets, plan-B §4). Чтение билета — только владельцу (`withAccessToken`, сервер `no-store`);
 * сводка регистрации старта — публичная. Каждый успешный `getTicket` пишет офлайн-копию (RC-B8); 404 — стирает её.
 */
export const ticketKeys = {
  all: ['tickets'] as const,
  list: ['tickets', 'list'] as const,
  detail: (code: string) => ['tickets', 'detail', code] as const,
};
export const calendarTicketingKey = (id: string) => ['calendar', 'ticketing', id] as const;
export const calendarRegistrationKey = (id: string) => ['calendar', 'registration', id] as const;

/** Сервер отдаёт публичную сводку с `public, max-age=60`. */
const PUBLIC_STALE_MS = 60_000;
/** Предзагрузка ближайших билетов для офлайн-копии (RC-B8): лимит чтения 120/мин — запас. */
export const PREFETCH_TICKETS = 3;

/** Билет по коду; успех — копия владельцу сессии начала запроса (ответ `withAccessToken` — той же сессии). */
async function fetchTicket(code: string): Promise<TicketView> {
  const owner = sessionOwner(useSessionStore.getState().session);
  try {
    const view = await withAccessToken((token) => api.getTicket(token, code));
    if (owner) void saveOfflineTicket(owner, view);
    return view;
  } catch (error) {
    if (apiErrorCode(error) === 'NOT_FOUND') void removeOfflineTicket(code);
    throw error;
  }
}

const ticketQuery = (code: string) => ({
  queryKey: ticketKeys.detail(code),
  queryFn: () => fetchTicket(code),
  staleTime: DEFAULT_STALE_MS,
});

/** Экран билета: только вошедшему; 4xx не повторяются (`shouldRetry` клиента). */
export function useTicket(code: string, enabled: boolean) {
  return useQuery({ ...ticketQuery(code), enabled });
}

/** «Ваши билеты» (Главная) + предзагрузка ближайших `upcoming` — офлайн-копии без открытия билета (RC-B8). */
export function useMyTickets(enabled: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ticketKeys.list,
    queryFn: () => withAccessToken((token) => api.listTickets(token)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
  const upcoming = query.data?.upcoming;
  useEffect(() => {
    if (!upcoming) return;
    for (const ticket of upcoming.slice(0, PREFETCH_TICKETS)) {
      if (ticket.status === 'cancelled') continue;
      void queryClient.prefetchQuery(ticketQuery(ticket.code));
    }
  }, [upcoming, queryClient]);
  return query;
}

/** Сводка регистрации старта календаря (публично, только клиент). */
export function useCalendarTicketing(id: string, enabled: boolean) {
  return useQuery({
    queryKey: calendarTicketingKey(id),
    queryFn: () => api.getEventTicketing('calendar', id),
    staleTime: PUBLIC_STALE_MS,
    enabled,
  });
}

/** Своя регистрация на старт и билет (вошедшему при включённых билетах). */
export function useCalendarRegistration(id: string, enabled: boolean) {
  return useQuery({
    queryKey: calendarRegistrationKey(id),
    queryFn: () => withAccessToken((token) => api.getCalendarRegistration(token, id)),
    staleTime: DEFAULT_STALE_MS,
    enabled,
  });
}

/**
 * Сводка мест после своей регистрации и отказа 409 — в обход HTTP-кэша (`public, max-age=60`): обычный перезапрос
 * браузер отдал бы из кэша со старыми местами. Ошибка — тихо: блок остаётся с прежней сводкой.
 */
async function refreshTicketing(queryClient: QueryClient, id: string): Promise<void> {
  await queryClient
    .fetchQuery({
      queryKey: calendarTicketingKey(id),
      queryFn: () => api.getEventTicketing('calendar', id, { fresh: true }),
      staleTime: 0,
    })
    .catch(() => undefined);
}

/** Билет перестал действовать (отмена регистрации или заявки): офлайн-копия с QR стирается. */
export function forgetCancelledTicket(code: string | undefined): void {
  if (code) void removeOfflineTicket(code);
}

async function applyRegistration(
  queryClient: QueryClient,
  id: string,
  state: CalendarRegistrationState,
): Promise<void> {
  const previous = queryClient.getQueryData<CalendarRegistrationState>(calendarRegistrationKey(id));
  await queryClient.cancelQueries({ queryKey: calendarRegistrationKey(id) });
  queryClient.setQueryData(calendarRegistrationKey(id), state);
  if (state.ticket === null || state.ticket.status === 'cancelled') {
    forgetCancelledTicket(previous?.ticket?.code ?? state.ticket?.code);
  }
  await Promise.all([
    refreshTicketing(queryClient, id),
    queryClient.invalidateQueries({ queryKey: ticketKeys.all }),
  ]);
}

/**
 * Регистрация и отмена (`networkMode: 'always'` — офлайн даёт ошибку, а не вечную паузу): ответ — в кеш регистрации,
 * сводка мест и билеты устаревают; «мест нет» / «закрыта» — сводка перезапрашивается.
 */
function useRegistrationMutation<V>(
  id: string,
  call: (token: string, body: V) => Promise<CalendarRegistrationState>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: V) => withAccessToken((token) => call(token, body)),
    onSuccess: (state) => applyRegistration(queryClient, id, state),
    onError: (error) => {
      if (isStaleTicketingError(error)) void refreshTicketing(queryClient, id);
    },
  });
}

export const useRegisterForCalendarStart = (id: string) =>
  useRegistrationMutation<CalendarRegistrationRequest>(id, (token, body) =>
    api.registerForCalendar(token, id, body),
  );

export const useCancelCalendarRegistration = (id: string) =>
  useRegistrationMutation<void>(id, (token) => api.cancelCalendarRegistration(token, id));
