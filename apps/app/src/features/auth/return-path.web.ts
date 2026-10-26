import { isReturnPath, RETURN_PATH_KEY } from './return-path-allowlist';

/**
 * Web: путь возврата — память и `sessionStorage` вкладки (переживает перезагрузку при входе и подтверждении
 * e-mail в той же вкладке). Хранилище недоступно (SSR, приватный режим) — только память, не падаем.
 */
let pending: string | null = null;

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberReturnPath(path: string): void {
  pending = isReturnPath(path) ? path : null;
  try {
    if (pending) storage()?.setItem(RETURN_PATH_KEY, pending);
    else storage()?.removeItem(RETURN_PATH_KEY);
  } catch {
    // без хранилища — только память
  }
}

export function takeReturnPath(): string | null {
  let path = pending;
  pending = null;
  try {
    path ??= storage()?.getItem(RETURN_PATH_KEY) ?? null;
    storage()?.removeItem(RETURN_PATH_KEY);
  } catch {
    // без хранилища — только память
  }
  return path !== null && isReturnPath(path) ? path : null;
}
