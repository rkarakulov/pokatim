import { Uuid } from '@pokatim/contracts';

/** Объекты, к которым гость возвращается после входа или регистрации (`pokatim-app.md` «Deep links», Q13). */
const RETURN_PATH = /^\/(rides|races|calendar)\/([^/?#]+)$/;

/**
 * Только путь карточки из allowlist с `Uuid`: не адрес, не протокол, не `//host` — без open redirect. Общий для
 * `return-path(.web).ts`.
 */
export function isReturnPath(path: string): boolean {
  const match = RETURN_PATH.exec(path);
  return match !== null && Uuid.safeParse(match[2]).success;
}

/** Ключ `sessionStorage` вкладки (web). */
export const RETURN_PATH_KEY = 'pokatim.returnPath';
