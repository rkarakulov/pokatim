import { isReturnPath } from './return-path-allowlist';

/** Native: путь возврата — память процесса (холодный старт его забывает — принято). */
let pending: string | null = null;

/**
 * Запомнить карточку, к которой вернуть гостя после входа (нажал «Я иду» без входа). Путь вне allowlist —
 * не запоминается.
 */
export function rememberReturnPath(path: string): void {
  pending = isReturnPath(path) ? path : null;
}

/** Забрать путь возврата один раз (корневой layout после входа и онбординга); повтор — `null`. */
export function takeReturnPath(): string | null {
  const path = pending;
  pending = null;
  return path !== null && isReturnPath(path) ? path : null;
}
