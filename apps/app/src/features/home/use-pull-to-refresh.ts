import { onlineManager } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

/** Завершается, когда сети нет (сразу) или она пропала: запросы TanStack Query встают на паузу и ждут сеть. */
function offline(): { promise: Promise<void>; dispose: () => void } {
  let dispose: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    if (!onlineManager.isOnline()) {
      resolve();
      return;
    }
    dispose = onlineManager.subscribe((online) => {
      if (!online) resolve();
    });
  });
  return { promise, dispose };
}

/**
 * Pull-to-refresh Главной (R7): `refreshing` — только на время жеста пользователя, не на фоновых refetch (данные
 * остаются на экране — это не загрузка «вместо контента», §4.12). Сбой одного запроса не держит индикатор: его
 * ошибку показывает слот раздела. Без сети запросы встают на паузу (их promise ждёт сеть) — индикатор снимается
 * сразу, а запросы возобновятся сами, когда сеть вернётся (`onlineManager`).
 */
export function usePullToRefresh(refetchers: readonly (() => Promise<unknown>)[]) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const network = offline();
    try {
      await Promise.race([
        Promise.allSettled(refetchers.map((refetch) => refetch())),
        network.promise,
      ]);
    } finally {
      network.dispose();
      setRefreshing(false);
    }
  }, [refetchers]);
  return { refreshing, onRefresh };
}
