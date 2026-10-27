import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useRegistrationStore } from './registration-store';
import { type SignOutOptions, useSessionStore } from './session-store';

/**
 * Выход (native и web): сервер отзывает сессию, устройство её забывает (SecureStore / cookie), кеш запросов прежнего
 * пользователя и незавершённая регистрация очищаются. Не бросает: офлайн — локальный выход всё равно. Гард ведёт на
 * «Вход» (`returning`); после удаления аккаунта — `{ returning: false, notice: 'accountDeleted' }`: «Регистрация» с
 * сообщением.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useCallback(
    async (options?: SignOutOptions) => {
      await useSessionStore.getState().signOut(options);
      queryClient.clear();
      await useRegistrationStore.getState().clear();
    },
    [queryClient],
  );
}
