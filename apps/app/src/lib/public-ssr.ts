import { Uuid } from '@pokatim/contracts';
import type { z } from 'zod';

/*
 * SSR-чтение публичных экранов (R5 блока 03) — только `loader` и `generateMetadata` (web-сервер). Экран берёт данные
 * из API через TanStack Query; здесь — посев HTML и мета. Любая ошибка (нет `API_INTERNAL_URL`, сеть, таймаут, 404,
 * 429, 5xx, битый ответ) — `null`: страница не падает в 500, данные догрузит браузер со своего IP.
 *
 * Кэш в памяти процесса по пути — исключение из правила «сторы не на уровне модуля»: в нём только публичные
 * одинаковые для всех данные (не сессия, не ПДн). TTL = `max-age` ответа API (60 с): `loader` и `generateMetadata`
 * одного HTML делают один запрос, а все гости делят IP-лимит `public-read` web-сервера реже. Успех и `404` кэшируются,
 * сбои (сеть, 429, 5xx) — нет.
 */

const TIMEOUT_MS = 2_000;
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { expiresAt: number; value: unknown }>();

/** Только для тестов: очистить кэш процесса. */
export function resetPublicSsrCache(): void {
  cache.clear();
}

function remember(path: string, value: unknown): void {
  if (cache.size >= MAX_ENTRIES) {
    // старейшая запись — первая (Map хранит порядок вставки)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, { expiresAt: Date.now() + TTL_MS, value });
}

/** Путь публичного ресурса по id из URL: не `Uuid` — `null` (без запроса и без инъекции пути во внутренний API). */
export function publicPath(prefix: string, id: unknown, suffix = ''): string | null {
  const parsed = Uuid.safeParse(id);
  return parsed.success ? `${prefix}/${encodeURIComponent(parsed.data)}${suffix}` : null;
}

/** GET `API_INTERNAL_URL + path`, разбор схемой контракта; любая ошибка — `null`. */
export async function fetchPublicForSsr<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T | null;
  if (hit) cache.delete(path);

  const base = process.env.API_INTERNAL_URL;
  if (!base) return null;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) {
      remember(path, null);
      return null;
    }
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) return null;
    remember(path, parsed.data);
    return parsed.data;
  } catch {
    // сеть, таймаут, не JSON — без посева; URL и детали не логируем
    return null;
  }
}
