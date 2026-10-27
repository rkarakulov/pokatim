import type { QueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { withAccessToken } from '@/features/auth/authorized';
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

/**
 * Регистрация токена этого устройства (вход, запуск с сессией, выданное разрешение). Нет разрешения, `projectId`,
 * устройства или web — ничего не делает. Сбой не бросает: следующая попытка — при следующем входе или запуске.
 */
export async function registerDevicePush(): Promise<void> {
  const device = await obtainPushToken();
  if (!device) return;
  try {
    await withAccessToken((accessToken) => api.registerPushToken(accessToken, device));
    await rememberPushToken(device.token);
  } catch {
    // сеть, 429, выход во время запроса — без push до следующей попытки
  }
}

/**
 * Снять токен устройства до выхода (`useSignOut`, до `api.signOut`): следующий владелец устройства чужих push не
 * получит. Ошибка и таймаут выход не блокируют; локальная запись токена стирается всегда.
 */
export async function revokeDevicePushToken(): Promise<void> {
  const token = await storedPushToken();
  if (!token) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      withAccessToken((accessToken) => api.revokePushToken(accessToken, { token })),
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
