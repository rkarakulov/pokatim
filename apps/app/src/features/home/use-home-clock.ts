import { addLocalDays, minskDayStartUtc, minskToday } from '@pokatim/contracts';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * «Сейчас» для подписей Главной («До старта N дней», «закрывается сегодня»). Пересчитывается, когда пришли данные
 * (`dataUpdatedAt` — и при том же ответе после refetch), при возврате в фокус и в полночь по Минску на открытом
 * экране: подписи не остаются вчерашними (ревью pass 1).
 */
export function useHomeClock(dataUpdatedAt: readonly number[]): Date {
  const [now, setNow] = useState(() => new Date());
  const updated = dataUpdatedAt.join(',');
  const [seen, setSeen] = useState(updated);
  // новые данные (и тот же ответ после refetch) — «сейчас» пересчитывается в этом же рендере
  if (seen !== updated) {
    setSeen(updated);
    setNow(new Date());
  }

  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) setNow(new Date());
      }),
    [],
  );

  useEffect(() => {
    const nextDay = minskDayStartUtc(addLocalDays(minskToday(now), 1)).getTime();
    const timer = setTimeout(() => setNow(new Date()), nextDay - now.getTime());
    return () => clearTimeout(timer);
  }, [now]);

  return now;
}

/** Сеть по `onlineManager` (native — NetInfo, web — `navigator.onLine`); на SSR — «есть». */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
    () => true,
  );
}
