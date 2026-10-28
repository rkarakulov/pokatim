import { Uuid } from '@pokatim/contracts';
import type { z } from 'zod';

/*
 * SSR-чтение публичных экранов (R5 блока 03) — только `loader` и `generateMetadata` (web-сервер). Экран берёт данные
 * из API через TanStack Query; здесь — посев HTML и мета. Результат различает «нашлось», «не найдено» (404: мета с
 * `noindex`) и «недоступно» (нет `API_INTERNAL_URL`, сеть, таймаут, 429, 5xx, битый ответ: нейтральная мета без
 * `robots` — объект есть, превью не должно выкинуть его из индекса). Страница не падает в 500, данные догрузит
 * браузер со своего IP.
 *
 * Кэш в памяти процесса по пути — исключение из правила «сторы не на уровне модуля»: в нём только публичные
 * одинаковые для всех данные (не сессия, не ПДн). TTL = `max-age` ответа API (60 с): `loader` и `generateMetadata`
 * одного HTML делают один запрос, а все гости делят IP-лимит `public-read` web-сервера реже. Успехи и `404` — в
 * разных пулах: поток ссылок на несуществующие id не вытесняет найденное. Сбои не кэшируются.
 */

export type PublicSsrResult<T> =
  { status: 'found'; data: T } | { status: 'notFound' } | { status: 'unavailable' };

const TIMEOUT_MS = 2_000;
const TTL_MS = 60_000;
const FOUND_MAX = 500;
const NOT_FOUND_MAX = 100;

const NOT_FOUND = { status: 'notFound' } as const;
const UNAVAILABLE = { status: 'unavailable' } as const;

type Entry = { expiresAt: number; result: PublicSsrResult<unknown> };
const found = new Map<string, Entry>();
const notFound = new Map<string, Entry>();

/** Только для тестов: очистить кэш процесса. */
export function resetPublicSsrCache(): void {
  found.clear();
  notFound.clear();
}

function remember(
  pool: Map<string, Entry>,
  max: number,
  path: string,
  result: PublicSsrResult<unknown>,
) {
  if (pool.size >= max) {
    // старейшая запись — первая (Map хранит порядок вставки)
    const oldest = pool.keys().next().value;
    if (oldest !== undefined) pool.delete(oldest);
  }
  pool.set(path, { expiresAt: Date.now() + TTL_MS, result });
}

function cached<T>(path: string): PublicSsrResult<T> | undefined {
  for (const pool of [found, notFound]) {
    const hit = pool.get(path);
    if (!hit) continue;
    if (hit.expiresAt > Date.now()) return hit.result as PublicSsrResult<T>;
    pool.delete(path);
  }
  return undefined;
}

/**
 * Путь публичного ресурса по id из URL: не проходит схему (по умолчанию `Uuid`; токен — схема из contracts, например
 * `RiderPublicId`) — `null` (без запроса и без инъекции пути во внутренний API).
 */
export function publicPath(
  prefix: string,
  id: unknown,
  suffix = '',
  idSchema: z.ZodType<string> = Uuid,
): string | null {
  const parsed = idSchema.safeParse(id);
  return parsed.success ? `${prefix}/${encodeURIComponent(parsed.data)}${suffix}` : null;
}

/** Данные для посева `loader`: нашлось — данные, иначе `null`. */
export const ssrData = <T>(result: PublicSsrResult<T>): T | null =>
  result.status === 'found' ? result.data : null;

export interface PublicSsrOptions {
  /**
   * `false` — мимо кэша процесса (не читать и не класть): у вызывающего своё окно обновления (тема процесса,
   * `ssr-theme.ts`), второе окно кэша удвоило бы задержку.
   */
  cache?: boolean;
}

/** GET `API_INTERNAL_URL + path`, разбор схемой контракта. */
export async function fetchPublicForSsr<T>(
  path: string,
  schema: z.ZodType<T>,
  { cache = true }: PublicSsrOptions = {},
): Promise<PublicSsrResult<T>> {
  const hit = cache ? cached<T>(path) : undefined;
  if (hit) return hit;

  const base = process.env.API_INTERNAL_URL;
  if (!base) return UNAVAILABLE;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) {
      if (cache) remember(notFound, NOT_FOUND_MAX, path, NOT_FOUND);
      return NOT_FOUND;
    }
    if (!response.ok) return UNAVAILABLE;
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) return UNAVAILABLE;
    const result = { status: 'found' as const, data: parsed.data };
    if (cache) remember(found, FOUND_MAX, path, result);
    return result;
  } catch {
    // сеть, таймаут, не JSON — без посева; URL и детали не логируем
    return UNAVAILABLE;
  }
}
