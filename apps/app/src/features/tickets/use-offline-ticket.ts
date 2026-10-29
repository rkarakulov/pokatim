import { useEffect, useState } from 'react';

import { sessionOwner } from '@/features/auth/session-identity';
import { useSessionStore } from '@/features/auth/session-store';

import type { OfflineTicket } from './offline-model';
import { readOfflineTicket } from './offline-store';

/**
 * Офлайн-копия билета для экрана (AC12): читается после монтирования (SSR — без копии). Владелец — `sub` сессии; сессия `unavailable` (web: сервер недоступен при запуске) — владелец неизвестен,
 * копия своего снимка (RC-B4: копии стираются при выходе и при запуске без сессии). Гость — без копии.
 */
export function useOfflineTicket(code: string, active: boolean): OfflineTicket | null {
  const status = useSessionStore((state) => state.status);
  const owner = useSessionStore((state) => sessionOwner(state.session));
  const [found, setFound] = useState<{ key: string; copy: OfflineTicket | null } | null>(null);

  // `null` — владелец неизвестен (сессия не проверена); `undefined` — копии быть не может (гость, нет метки)
  const reader: string | null | undefined =
    status === 'signedIn' ? owner : status === 'unavailable' ? null : undefined;
  const key = `${reader ?? '?'}:${code}`;
  useEffect(() => {
    if (!active || reader === undefined) return;
    let cancelled = false;
    void readOfflineTicket(reader, code).then((copy) => {
      if (!cancelled) setFound({ key, copy });
    });
    return () => {
      cancelled = true;
    };
  }, [active, reader, code, key]);

  // результат другого ключа (сменились владелец или код) или «копии быть не может» — не показываем
  const copy = active && reader !== undefined && found?.key === key ? found.copy : null;
  return copy;
}
