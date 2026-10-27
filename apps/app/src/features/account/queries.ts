import type { DeleteAccountRequest } from '@pokatim/contracts';
import { useMutation } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { useSignOut } from '@/features/auth/use-sign-out';
import { api } from '@/lib/api';

/**
 * Удаление своего аккаунта (`POST /v1/account/delete`, A1/A2): успех — локальный выход без «возврата на вход» с
 * отметкой «Аккаунт удалён» (сервер уже отозвал все сессии; web — очистил cookie). Экран сам уходит на «Регистрацию»
 * по отметке. 401 после обновления access (сессию отозвал другой клиент) — обычный локальный выход `withAccessToken`.
 */
export function useDeleteAccount() {
  const signOut = useSignOut();
  return useMutation({
    mutationFn: (body: DeleteAccountRequest) =>
      withAccessToken((accessToken) => api.deleteAccount(accessToken, body)),
    networkMode: 'always',
    onSuccess: () => signOut({ returning: false, notice: 'accountDeleted' }),
  });
}
