import { useCallback, useEffect, useState } from 'react';

/**
 * Текущее время, обновляемое раз в `intervalMs`, пока `active` (отсчёты паузы входа и повтора письма). `sync()` —
 * сверить сразу (вызывать в обработчике вместе с установкой нового срока, иначе отсчёт на тик отстаёт).
 */
export function useNow(active: boolean, intervalMs = 1000): [now: number, sync: () => void] {
  const [now, setNow] = useState(() => Date.now());
  const sync = useCallback(() => setNow(Date.now()), []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return [now, sync];
}
