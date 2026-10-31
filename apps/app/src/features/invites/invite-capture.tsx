import { useGlobalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useSessionStore } from '@/features/auth/session-store';

import { rememberInvite } from './invite-storage';

/**
 * Переход по ссылке с `?invite=<код>` (любая страница web, deep link native; P6, K9) — код сохраняется для
 * регистрации. Вошедшему код не нужен; пока сессия неизвестна (SSR, запуск) — сохраняем: код читает только
 * регистрация (RC-P6-7). Монтируется в корне (`RootShell`).
 */
export function InviteCapture() {
  const { invite } = useGlobalSearchParams<{ invite?: string | string[] }>();
  const status = useSessionStore((state) => state.status);
  const raw = Array.isArray(invite) ? invite[0] : invite;
  useEffect(() => {
    if (!raw || status === 'signedIn') return;
    void rememberInvite(raw, Date.now());
  }, [raw, status]);
  return null;
}
