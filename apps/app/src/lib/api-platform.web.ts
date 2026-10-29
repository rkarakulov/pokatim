import type { ApiClientOptions } from '@pokatim/api-client';

/**
 * Запросы к API без `Referer` (event-tickets, ревью pass 3): адрес страницы — например `/tickets/<код>` после
 * клиентского перехода, где серверный `Referrer-Policy` документа не действует, — не уходит в журналы API (на проде
 * API — тот же origin). API заголовок не нужен. `fetch` берётся при вызове (тесты подменяют глобальный).
 */
const fetchWithoutReferrer: typeof fetch = (input, init) =>
  fetch(input, { ...init, referrerPolicy: 'no-referrer' });

/**
 * Web (ADR-0003 п. 4): refresh — в httpOnly cookie, которую ставит API. `credentials: 'include'` — cookie уходит
 * и на API другого origin в dev (`127.0.0.1:8081` → `:3000`, same-site); транспорт `cookie` — сервер не кладёт
 * refresh в тело ответа.
 */
export const apiPlatformOptions: Partial<ApiClientOptions> = {
  credentials: 'include',
  sessionTransport: 'cookie',
  fetchImpl: fetchWithoutReferrer,
};
