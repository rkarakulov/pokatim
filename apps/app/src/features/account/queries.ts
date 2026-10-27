import type { DeleteAccountRequest } from '@pokatim/contracts';
import { useMutation } from '@tanstack/react-query';

import { withAccessToken } from '@/features/auth/authorized';
import { forgetEndedSession } from '@/features/auth/session-persistence';
import { withSessionLock } from '@/features/auth/session-lock';
import { useSignOut } from '@/features/auth/use-sign-out';
import { api } from '@/lib/api';

/**
 * Удаление своего аккаунта (`POST /v1/account/delete`, A1/A2) — сессионная операция: ответ на web стирает cookie,
 * поэтому запрос и забывание сессии устройством — одна задача под замком сессии (`withSessionLock`), как вход и
 * выход: вход другой вкладки не встанет между ними. Замок берётся только вокруг запроса — refresh `withAccessToken`
 * (401, истекающий access) берёт его сам, вне этой задачи, без вложенного захвата. Сервер уже отозвал все сессии —
 * отдельного sign-out нет. Удаление подтверждено, а сессия в памяти тем временем сменилась (`UnauthorizedError`) —
 * всё равно успех: аккаунта нет.
 */
export async function requestAccountDeletion(body: DeleteAccountRequest): Promise<void> {
  let deleted = false;
  try {
    await withAccessToken((accessToken) =>
      withSessionLock(async () => {
        await api.deleteAccount(accessToken, body);
        deleted = true;
        await forgetEndedSession();
      }),
    );
  } catch (error) {
    if (!deleted) throw error;
  }
}

/**
 * Успех — локальный выход без запроса отзыва и без «возврата на вход», с отметкой «Аккаунт удалён»: экран сам уходит
 * на «Регистрацию». 401 после обновления access (сессию отозвал другой клиент) — обычный локальный выход
 * `withAccessToken`.
 */
export function useDeleteAccount() {
  const signOut = useSignOut();
  return useMutation({
    mutationFn: requestAccountDeletion,
    networkMode: 'always',
    onSuccess: () => signOut({ returning: false, notice: 'accountDeleted', serverEnded: true }),
  });
}
