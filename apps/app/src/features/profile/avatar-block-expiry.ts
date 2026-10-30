import type { ProfileView } from '@pokatim/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { PROFILE_QUERY_KEY } from '@/features/home/queries';

/** Предел задержки `setTimeout` (2^31-1 мс ≈ 24,8 дня): дальше таймер срабатывает сразу. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** Повторная проверка, если сервер ещё держит запрет (часы устройства впереди сервера). */
export const AVATAR_BLOCK_RECHECK_MS = 30_000;

/**
 * Запрет загрузки фото истёк при открытом экране (ревью pass 1, MEDIUM): в момент окончания — перечитывание
 * `['profile']`; кнопку разблокирует только ответ сервера (`avatarUploadBlockedUntil: null`). Срок дальше предела
 * `setTimeout` — цепочкой таймеров не длиннее `MAX_TIMEOUT_MS`; сервер ответил тем же сроком — проверка через
 * `AVATAR_BLOCK_RECHECK_MS`. Смена срока и размонтирование отменяют таймер.
 */
export function useAvatarBlockExpiry(blockedUntil: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!blockedUntil) return;
    const until = Date.parse(blockedUntil);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (delay: number) => {
      timer = setTimeout(() => void tick(), Math.min(Math.max(delay, 0), MAX_TIMEOUT_MS));
    };
    const tick = async () => {
      const left = until - Date.now();
      if (left > 0) {
        schedule(left);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      if (cancelled) return;
      const now =
        queryClient.getQueryData<ProfileView>(PROFILE_QUERY_KEY)?.avatarUploadBlockedUntil;
      if (now === blockedUntil) schedule(AVATAR_BLOCK_RECHECK_MS);
    };

    schedule(until - Date.now());
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [blockedUntil, queryClient]);
}
