import {
  freshReturnPath,
  isReturnPath,
  RETURN_PATH_KEY,
  type PendingReturn,
} from './return-path-allowlist';

/**
 * Web: путь возврата — память и `sessionStorage` вкладки (переживает перезагрузку при входе и подтверждении
 * e-mail в той же вкладке); живёт 30 минут. Хранилище недоступно (SSR, приватный режим) — только память, не падаем.
 */
let pending: PendingReturn | null = null;

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Запись из хранилища: только `{ path: string, at: number }`, иначе — нет пути. */
function parse(raw: string | null | undefined): PendingReturn | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as PendingReturn).path === 'string' &&
      typeof (value as PendingReturn).at === 'number'
    ) {
      return value as PendingReturn;
    }
  } catch {
    // не JSON — нет пути
  }
  return null;
}

export function rememberReturnPath(path: string): void {
  pending = isReturnPath(path) ? { path, at: Date.now() } : null;
  try {
    if (pending) storage()?.setItem(RETURN_PATH_KEY, JSON.stringify(pending));
    else storage()?.removeItem(RETURN_PATH_KEY);
  } catch {
    // без хранилища — только память
  }
}

export function takeReturnPath(): string | null {
  let taken = pending;
  pending = null;
  try {
    taken ??= parse(storage()?.getItem(RETURN_PATH_KEY));
    storage()?.removeItem(RETURN_PATH_KEY);
  } catch {
    // без хранилища — только память
  }
  return freshReturnPath(taken);
}
