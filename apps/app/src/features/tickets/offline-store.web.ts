import type { TicketView } from '@pokatim/contracts';

import { NO_SESSION_KEY, SIGN_OUT_PENDING_KEY } from '@/features/auth/session-markers';

import {
  type OfflineSnapshot,
  type OfflineTicket,
  parseSnapshot,
  pickTicket,
  withTicket,
} from './offline-model';

/**
 * Web (plan-B §5, RC-B4): одна запись `localStorage['pokatim.ticketsOffline'] = { owner, items }` — переживает
 * перезапуск PWA (холодный офлайн-старт). Доступ — только из эффектов и обработчиков (SSR без `window` — без копии);
 * сбой хранилища — тихо. QR в `localStorage` доступен XSS той же origin — та же поверхность, что access в памяти.
 * Выход стирает и HTML-оболочку билета из кеша service worker (`tickets-shell-*`, `scripts/service-worker.ts`).
 */
export const OFFLINE_TICKETS_KEY = 'pokatim.ticketsOffline';
/** Префикс кеша оболочки `/tickets/*` в service worker. */
export const TICKETS_SHELL_CACHE_PREFIX = 'tickets-shell-';

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Выход в соседней вкладке (признаки сессии общие для вкладок): эта вкладка ещё «вошла», но копии уже чужие —
 * не пишем и не отдаём, прежние стираем.
 */
function signedOutElsewhere(): boolean {
  try {
    const store = storage();
    return (
      store !== undefined &&
      (store.getItem(NO_SESSION_KEY) !== null || store.getItem(SIGN_OUT_PENDING_KEY) !== null)
    );
  } catch {
    return false;
  }
}

function read(): OfflineSnapshot | null {
  try {
    if (signedOutElsewhere()) {
      storage()?.removeItem(OFFLINE_TICKETS_KEY);
      return null;
    }
    return parseSnapshot(storage()?.getItem(OFFLINE_TICKETS_KEY) ?? null);
  } catch {
    return null;
  }
}

function write(snapshot: OfflineSnapshot | null): void {
  try {
    if (snapshot === null || Object.keys(snapshot.items).length === 0) {
      storage()?.removeItem(OFFLINE_TICKETS_KEY);
    } else storage()?.setItem(OFFLINE_TICKETS_KEY, JSON.stringify(snapshot));
  } catch {
    // хранилище недоступно или переполнено: сценарий без копии
  }
}

export async function saveOfflineTicket(
  owner: string,
  view: TicketView,
  now = Date.now(),
): Promise<void> {
  if (signedOutElsewhere()) {
    write(null);
    return;
  }
  write(withTicket(read(), owner, view, now));
}

/** Копия для показа; `owner: null` — владелец неизвестен (запуск без связи с сервером, RC-B4). */
export async function readOfflineTicket(
  owner: string | null,
  code: string,
  now = Date.now(),
): Promise<OfflineTicket | null> {
  const snapshot = read();
  if (snapshot && owner !== null && snapshot.owner !== owner) {
    write(null);
    return null;
  }
  return pickTicket(snapshot, owner, code, now);
}

export async function removeOfflineTicket(code: string): Promise<void> {
  const snapshot = read();
  if (!snapshot?.items[code]) return;
  write({
    owner: snapshot.owner,
    items: Object.fromEntries(Object.entries(snapshot.items).filter(([key]) => key !== code)),
  });
}

/** Выход: копии и закешированная оболочка `/tickets/*` service worker. */
export async function clearOfflineTickets(): Promise<void> {
  write(null);
  try {
    const cacheStorage = globalThis.caches;
    if (!cacheStorage) return;
    const keys = await cacheStorage.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(TICKETS_SHELL_CACHE_PREFIX))
        .map((key) => cacheStorage.delete(key)),
    );
  } catch {
    // Cache API недоступен (не https, политика): оболочки нет
  }
}
