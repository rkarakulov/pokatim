import { Uuid } from '@pokatim/contracts';

/** Объекты, к которым гость возвращается после входа или регистрации (`pokatim-app.md` «Deep links», Q13). */
const RETURN_PATH = /^\/(rides|races|calendar)\/([^/?#]+)$/;

/** Экраны за входом, открываемые гостем по ссылке, — точным путём без параметров (удаление аккаунта, A12). */
const RETURN_SCREENS: ReadonlySet<string> = new Set(['/settings/account/delete']);

/**
 * Только путь карточки из allowlist с `Uuid` или точный путь экрана: не адрес, не протокол, не `//host` — без open
 * redirect. Общий для `return-path(.web).ts`.
 */
export function isReturnPath(path: string): boolean {
  if (RETURN_SCREENS.has(path)) return true;
  const match = RETURN_PATH.exec(path);
  return match !== null && Uuid.safeParse(match[2]).success;
}

/**
 * Путь возврата живёт 30 минут: брошенный вход не должен через час увести на карточку после постороннего входа.
 */
export const RETURN_PATH_TTL_MS = 30 * 60_000;

/** Запомненный путь и момент (мс, часы устройства). */
export interface PendingReturn {
  path: string;
  at: number;
}

/** Путь, если он из allowlist и не старше TTL; иначе `null`. */
export function freshReturnPath(pending: PendingReturn | null, now = Date.now()): string | null {
  if (!pending || !isReturnPath(pending.path)) return null;
  return now - pending.at <= RETURN_PATH_TTL_MS && now >= pending.at ? pending.path : null;
}

/** Ключ `sessionStorage` вкладки (web). */
export const RETURN_PATH_KEY = 'pokatim.returnPath';
