import type { QueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { pushTargetPath } from './notification-target';
import {
  forgetPushToken,
  obtainPushToken,
  rememberPushToken,
  storedPushToken,
  subscribePushResponses,
} from './push';
import { unreadCountKey } from './queries';

/** Снятие токена при выходе не задерживает выход дольше этого (сеть, сервер). */
export const REVOKE_TIMEOUT_MS = 3_000;

/** Регистрации в полёте: выход дожидается их (в пределах таймаута), чтобы снять и их токен. */
const inFlight = new Set<Promise<void>>();
/** Сессия, выход из которой начат: под ней новые регистрации не стартуют (новый вход — другая сессия). */
let closingSession: object | null = null;

const closing = () => {
  const session = useSessionStore.getState().session;
  return session !== null && session === closingSession;
};

/**
 * Регистрация токена этого устройства (вход, запуск с сессией, выданное разрешение). Нет разрешения, `projectId`,
 * устройства или web — ничего не делает. Токен запоминается до запроса: выход, начавшийся во время запроса, снимет
 * и его. После начала выхода не стартует. Сбой не бросает: следующая попытка — при следующем входе или запуске.
 */
export function registerDevicePush(): Promise<void> {
  if (closing()) return Promise.resolve();
  const run = registerToken().finally(() => inFlight.delete(run));
  inFlight.add(run);
  return run;
}

async function registerToken(): Promise<void> {
  const device = await obtainPushToken();
  if (!device || closing()) return;
  await rememberPushToken(device.token);
  if (closing()) return;
  try {
    await withAccessToken((accessToken) => api.registerPushToken(accessToken, device));
  } catch {
    // сеть, 429, выход во время запроса — без push до следующей попытки
  }
}

/**
 * Снять токен устройства до выхода (`useSignOut`, до `api.signOut`): следующий владелец устройства чужих push не
 * получит. Новые регистрации под этой сессией не стартуют; начатые — дожидаются, и снимается их токен. Ошибка и
 * таймаут (общий на ожидание и запрос) выход не блокируют; локальная запись токена стирается всегда. Поздняя запись
 * на сервере после таймаута push не вернёт: токен привязан к сессии, а она отзывается выходом.
 */
export async function revokeDevicePushToken(): Promise<void> {
  closingSession = useSessionStore.getState().session;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      revokeStoredToken(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, REVOKE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // офлайн или сессии уже нет — выход всё равно локальный
  } finally {
    clearTimeout(timer);
    await forgetPushToken();
  }
}

async function revokeStoredToken(): Promise<void> {
  await Promise.allSettled([...inFlight]);
  const token = await storedPushToken();
  if (!token) return;
  await withAccessToken((accessToken) => api.revokePushToken(accessToken, { token }));
}

/**
 * Push в корневом layout (`ready` — вошёл и прошёл онбординг): регистрация токена и нажатия на push → экран цели
 * из белого списка (иначе — центр уведомлений); пришедший push обновляет счётчик колокольчика. Web — no-op.
 * `queryClient` — явно: корневой layout сам создаёт провайдер и вызывает хук вне него.
 */
export function usePushNotifications(ready: boolean, queryClient: QueryClient): void {
  const router = useRouter();

  useEffect(() => {
    if (ready) void registerDevicePush();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    return subscribePushResponses({
      onOpen: (target) => router.push(pushTargetPath(target)),
      onReceive: () => void queryClient.invalidateQueries({ queryKey: unreadCountKey }),
    });
  }, [ready, router, queryClient]);
}
