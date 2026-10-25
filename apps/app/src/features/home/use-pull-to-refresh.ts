import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh Главной (R7): `refreshing` — только на время жеста пользователя, не на фоновых refetch (данные
 * остаются на экране — это не загрузка «вместо контента», §4.12). Сбой одного запроса не держит индикатор:
 * его ошибку показывает слот раздела.
 */
export function usePullToRefresh(refetchers: readonly (() => Promise<unknown>)[]) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(refetchers.map((refetch) => refetch()));
    } finally {
      setRefreshing(false);
    }
  }, [refetchers]);
  return { refreshing, onRefresh };
}
