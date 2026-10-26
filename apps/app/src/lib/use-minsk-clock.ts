import { addLocalDays, minskDayStartUtc, minskToday } from '@pokatim/contracts';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * «Сейчас» для подписей по Минску (Главная, вкладка «Гонки»: «До старта N дней», «закрывается сегодня»). Пересчитывается, когда пришли данные
 * (`dataUpdatedAt` — и при том же ответе после refetch), при возврате в фокус и в полночь по Минску на открытом
 * экране: подписи не остаются вчерашними (ревью pass 1).
 */
export function useMinskClock(dataUpdatedAt: readonly number[]): Date {
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

/**
 * «Сейчас» публичного экрана с SSR: `null` на сервере и при гидрации web (HTML совпадает с гидрацией — без «сегодня /
 * завтра»), затем — как `useMinskClock`.
 */
export function useMinskClockAfterMount(dataUpdatedAt: readonly number[]): Date | null {
  const now = useMinskClock(dataUpdatedAt);
  return useMounted() ? now : null;
}

/**
 * `false` на сервере и при гидрации web (разметка совпадает с SSR), затем `true`; native не гидрирует — сразу `true`.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribeNever, clientSnapshot, serverSnapshot);
}

const subscribeNever = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;
