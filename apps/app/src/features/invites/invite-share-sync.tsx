import { useEffect } from 'react';

import { isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { setShareInvite } from '@/lib/share-invite';

import { useOwnInviteCode } from './queries';

/**
 * Личный код вошедшего — в ссылки «Поделиться» (`withInvite` в `shareLink`, P6): гость, выход и код ещё не получен —
 * без параметра (AC2). Монтируется в корне (`RootShell`).
 */
export function InviteShareSync() {
  const signedIn = useSessionStore((state) => isSignedIn(state));
  const { data } = useOwnInviteCode();
  const code = signedIn ? (data?.code ?? null) : null;
  useEffect(() => {
    setShareInvite(code);
  }, [code]);
  return null;
}
