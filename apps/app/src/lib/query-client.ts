import { ApiHttpError } from '@pokatim/api-client';
import { QueryClient } from '@tanstack/react-query';

const MAX_RETRIES = 2;
/**
 * Свежесть по умолчанию (запросы без своего `staleTime`: участие, `me` райда, споры). При 0 каждый возврат фокуса
 * вкладки (`visibilitychange`) повторял только что пришедший ответ — «дубли» GET на смоуке dev (B13). Инвалидация
 * после мутаций, опрос (`refetchInterval`) и pull-to-refresh от `staleTime` не зависят.
 */
export const DEFAULT_STALE_MS = 10_000;

/** Повторяем то, что может пройти со второй попытки: сеть и 5xx. Ответ 4xx не изменится. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiHttpError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: DEFAULT_STALE_MS },
      mutations: { retry: false },
    },
  });
}
