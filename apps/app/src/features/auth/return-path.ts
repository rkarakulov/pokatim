import { freshReturnPath, isReturnPath, type PendingReturn } from './return-path-allowlist';

/** Native: путь возврата — память процесса (холодный старт его забывает — принято). */
let pending: PendingReturn | null = null;

/**
 * Запомнить карточку, к которой вернуть гостя после входа (нажал «Я иду» без входа). Путь вне allowlist —
 * не запоминается; живёт 30 минут.
 */
export function rememberReturnPath(path: string): void {
  pending = isReturnPath(path) ? { path, at: Date.now() } : null;
}

/** Забрать путь возврата один раз (корневой layout после входа и онбординга); повтор и устаревший — `null`. */
export function takeReturnPath(): string | null {
  const taken = pending;
  pending = null;
  return freshReturnPath(taken);
}
