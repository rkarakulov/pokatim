import type {
  CalendarRegistrationRequest,
  CalendarRegistrationState,
  TicketView,
} from '@pokatim/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

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

/**
 * Коды, на которые сервер ответил 404 (ревью pass 2): прежние данные запроса и офлайн-копия этого кода не
 * показываются, пока не придёт следующий успешный ответ — сбой сети после 404 не возвращает билет с QR.
 */
export const useGoneTickets = create<{ codes: Readonly<Record<string, true>> }>(() => ({
  codes: {},
}));
const markGone = (code: string, gone: boolean) =>
  useGoneTickets.setState(({ codes }) => {
    if ((codes[code] === true) === gone) return { codes };
    const next = { ...codes };
    if (gone) next[code] = true;
    else delete next[code];
    return { codes: next };
  });

/**
 * Поколение отмены билета (снятие заявки, отмена регистрации): ответ `getTicket`, начатый до отмены (предзагрузка
 * Главной), не сохраняет офлайн-копию — иначе вернулся бы прежний QR.
 */
let generation = 0;
const cancelledAt = new Map<string, number>();

/** Билет по коду; успех — копия владельцу сессии начала запроса (ответ `withAccessToken` — той же сессии). */
async function fetchTicket(code: string): Promise<TicketView> {
  const owner = sessionOwner(useSessionStore.getState().session);
  const started = generation;
  try {
    const view = await withAccessToken((token) => api.getTicket(token, code));
    markGone(code, false);
    if (owner && (cancelledAt.get(code) ?? 0) <= started) void saveOfflineTicket(owner, view);
    return view;
  } catch (error) {
    if (apiErrorCode(error) === 'NOT_FOUND') {
      markGone(code, true);
      void removeOfflineTicket(code);
    }
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

/**
 * Билет перестал действовать (отмена регистрации или заявки): офлайн-копия с QR стирается, данные запроса билета
 * сбрасываются, ответы, начатые до отмены, копию не восстанавливают.
 */
export function forgetCancelledTicket(queryClient: QueryClient, code: string | undefined): void {
  if (!code) return;
  generation += 1;
  cancelledAt.set(code, generation);
  queryClient.removeQueries({ queryKey: ticketKeys.detail(code) });
  void removeOfflineTicket(code);
}

/** «Повторить» сводки регистрации — в обход HTTP-кэша. */
export function useRefreshTicketing(id: string) {
  const queryClient = useQueryClient();
  return useCallback(() => void refreshTicketing(queryClient, id), [queryClient, id]);
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
    forgetCancelledTicket(queryClient, previous?.ticket?.code ?? state.ticket?.code);
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
