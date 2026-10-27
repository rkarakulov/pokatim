import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { httpStatus, isForbidden, isUnauthorized } from './errors';
import { ME_QUERY_KEY } from './me';

export interface SessionHandlers {
  /** Сессия панели погашена (401 на любом запросе после входа) — «Вход» с «Сессия истекла» и возвратом. */
  onUnauthorized: () => void;
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Ответ 401 обрабатывает сам экран (вход): глобальный редирект на «Вход» не нужен. */
      ownsUnauthorized?: boolean;
    };
  }
}

const sameKey = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((part, index) => part === b[index]);

/**
 * Клиент запросов панели: глобальные 401/403 (task admin-01 §7). 401 — `clear()` и «Вход» (кроме первой загрузки
 * `me`: её 401 обрабатывает `beforeLoad` без «Сессия истекла»); 403 — права могли смениться: `me` перечитывается,
 * экран показывает «Нет доступа к разделу». Ответы 4xx не повторяются.
 */
export function createQueryClient(handlers: SessionHandlers): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const firstMe = sameKey(query.queryKey, ME_QUERY_KEY) && query.state.data === undefined;
        if (isUnauthorized(error) && !firstMe) {
          client.clear();
          handlers.onUnauthorized();
        } else if (isForbidden(error) && !sameKey(query.queryKey, ME_QUERY_KEY)) {
          void client.invalidateQueries({ queryKey: ME_QUERY_KEY });
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.ownsUnauthorized) return;
        if (isUnauthorized(error)) {
          client.clear();
          handlers.onUnauthorized();
        } else if (isForbidden(error)) {
          void client.invalidateQueries({ queryKey: ME_QUERY_KEY });
        }
      },
    }),
    defaultOptions: {
      queries: {
        // фокус окна (клик во встроенном браузере, смена вкладки) давал второй такой же GET на экране (B12); заход на
        // экран по-прежнему перечитывает данные — так панель и узнаёт о погашенной сессии (401 → «Сессия истекла»)
        refetchOnWindowFocus: false,
        retry: (failures, error) => {
          const status = httpStatus(error);
          return (status === undefined || status >= 500) && failures < 2;
        },
      },
    },
  });
  return client;
}
