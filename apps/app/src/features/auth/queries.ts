import type {
  ConfirmPasswordResetRequest,
  RegisterRequest,
  RegistrationPollResponse,
  RequestPasswordResetRequest,
  ResendVerificationRequest,
  SignInRequest,
  SignInResponse,
} from '@pokatim/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import { apiErrorCode } from './error-messages';
import { withSessionLock } from './session-lock';
import { persistSession } from './session-persistence';
import { useSessionStore } from './session-store';

/** Интервал опроса подтверждения на экране «Подтвердите e-mail». */
export const POLL_INTERVAL_MS = 3000;

/**
 * Действия онбординга (мутации) уходят и офлайн: TanStack Query по умолчанию ставит мутацию на паузу, пока
 * `onlineManager` (NetInfo) считает сеть недоступной, — кнопка висела бы в «загрузке» без ошибки. Здесь запрос
 * сразу получает сетевую ошибку: баннер «Нет соединения» и повтор нажатием (AGENTS.md §4.12).
 */
export const AUTH_MUTATION = { networkMode: 'always' } as const;

export const authKeys = {
  verificationLink: (token: string) => ['auth', 'verification-link', token] as const,
  passwordResetLink: (token: string) => ['auth', 'password-reset-link', token] as const,
  registrationPoll: (registrationToken: string) =>
    ['auth', 'registration-poll', registrationToken] as const,
};

/** 401 по токену регистрации: токен истёк или уже обменян на сессию — дальше только вход по паролю. */
export const isRegistrationRejected = (error: unknown) => apiErrorCode(error) === 'UNAUTHORIZED';

export function useRegister() {
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: RegisterRequest) => api.register(body),
  });
}

/** Данные формы входа: транспорт сессии подмешивает клиент платформы. */
export type SignInCredentials = Omit<SignInRequest, 'sessionTransport'>;

/**
 * Вход по паролю — одна сессионная операция: запрос, сохранение refresh (native — SecureStore) и вход в памяти.
 * Ответ на web выставляет cookie сессии (и отзывает прежнюю) — поэтому под замком сессии, как refresh и выход; на
 * native — под замком приложения: выход, нажатый сразу после входа, ждёт записи и отзывает уже сохранённый refresh.
 */
export function requestSignIn(body: SignInCredentials): Promise<SignInResponse> {
  return withSessionLock(async () => {
    const response = await api.signIn(body);
    if (response.state === 'signedIn') {
      await persistSession(response.session);
      await useSessionStore.getState().signIn(response.session);
    }
    return response;
  });
}

export function useSignIn() {
  return useMutation({ ...AUTH_MUTATION, mutationFn: requestSignIn });
}

/** Чтение ссылки из письма — без побочных эффектов на сервере (C2). */
export function useVerificationLink(token: string) {
  return useQuery({
    queryKey: authKeys.verificationLink(token),
    queryFn: () => api.getVerificationLink(token),
  });
}

export function useConfirmVerification() {
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (token: string) => api.confirmVerification({ token }),
  });
}

export function useResendVerification() {
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: ResendVerificationRequest) => api.resendVerification(body),
  });
}

/**
 * Один запрос опроса. Ответ `verified` на web выставляет cookie сессии — поэтому под тем же замком, что refresh и
 * выход (`session-lock.web.ts`): запоздалый ответ восстановления в другой вкладке не придёт поверх новой cookie.
 * Native — без замка.
 */
export function fetchRegistrationPoll(
  registrationToken: string,
): Promise<RegistrationPollResponse> {
  return withSessionLock(async () => {
    const response = await api.pollRegistration({ registrationToken });
    // сессия выдаётся один раз — сохраняем в той же операции, до выхода или следующей ротации
    if (response.state === 'verified') await persistSession(response.session);
    return response;
  });
}

/**
 * Опрос подтверждения по токену регистрации. Ответ `verified` с сессией приходит ровно один раз,
 * поэтому он не перезапрашивается (staleTime ∞), а 401 не повторяется.
 */
export function useRegistrationPoll(registrationToken: string | undefined) {
  return useQuery<RegistrationPollResponse>({
    queryKey: authKeys.registrationPoll(registrationToken ?? ''),
    queryFn: () => fetchRegistrationPoll(registrationToken ?? ''),
    enabled: registrationToken !== undefined,
    staleTime: Infinity,
    refetchInterval: (query) =>
      query.state.data?.state === 'verified' || isRegistrationRejected(query.state.error)
        ? false
        : POLL_INTERVAL_MS,
    retry: (failureCount, error) => !isRegistrationRejected(error) && failureCount < 2,
  });
}

// Сброс пароля — вне Web Lock сессии: пути `/v1/auth/password-reset*` cookie сессии не видят и не меняют (вне
// `SESSION_COOKIE.path`). Локальный выход после смены пароля — через `useSignOut` (у него свой замок).

/** Запрос ссылки сброса: один и тот же ответ для любого адреса. */
export function useRequestPasswordReset() {
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: RequestPasswordResetRequest) => api.requestPasswordReset(body),
  });
}

/** Чтение ссылки сброса — без побочных эффектов на сервере; `enabled: false` — после смены пароля (кеш очищен выходом). */
export function usePasswordResetLink(token: string, enabled = true) {
  return useQuery({
    queryKey: authKeys.passwordResetLink(token),
    queryFn: () => api.getPasswordResetLink(token),
    enabled,
  });
}

/** Смена пароля по ссылке: сервер отзывает все сессии аккаунта и новую не выдаёт. */
export function useConfirmPasswordReset() {
  return useMutation({
    ...AUTH_MUTATION,
    mutationFn: (body: ConfirmPasswordResetRequest) => api.confirmPasswordReset(body),
  });
}
