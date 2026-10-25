import { useCallback, useEffect, useState } from 'react';

/**
 * Текущее время, обновляемое раз в `intervalMs`, пока `active` (отсчёты паузы входа и повтора письма). `sync()` —
 * сверить сразу и получить то же значение: новый срок считается от него (`sync() + сек * 1000`), поэтому оставшееся
 * время на первом рендере — ровно заданное, без расхождения на миллисекунды между двумя `Date.now()`.
 */
export function useNow(active: boolean, intervalMs = 1000): [now: number, sync: () => number] {
  const [now, setNow] = useState(() => Date.now());
  const sync = useCallback(() => {
    const at = Date.now();
    setNow(at);
    return at;
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return [now, sync];
}
