import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { forgetPushToken } from '@/features/notifications/push';
import { revokeDevicePushToken } from '@/features/notifications/push-registration';

import { useRegistrationStore } from './registration-store';
import { type SignOutOptions, useSessionStore } from './session-store';

/**
 * Выход (native и web): сервер отзывает сессию, устройство её забывает (SecureStore / cookie), кеш запросов прежнего
 * пользователя и незавершённая регистрация очищаются. Не бросает: офлайн — локальный выход всё равно. Гард ведёт на
 * «Вход» (`returning`); после удаления аккаунта — `{ returning: false, notice: 'accountDeleted' }`: «Регистрация» с
 * сообщением. Push-токен устройства снимается до отзыва сессии (ADR-0016); после удаления аккаунта (`serverEnded`) —
 * без запроса: сессии уже нет, токены сервер снял в транзакции удаления; устройство только забывает токен.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useCallback(
    async (options?: SignOutOptions) => {
      if (options?.serverEnded) await forgetPushToken();
      else await revokeDevicePushToken();
      await useSessionStore.getState().signOut(options);
      queryClient.clear();
      await useRegistrationStore.getState().clear();
    },
    [queryClient],
  );
}
