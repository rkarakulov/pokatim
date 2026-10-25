import { ApiHttpError } from '@pokatim/api-client';

import { refreshAccess } from './session-persistence';
import { useSessionStore } from './session-store';

/** Access истекает раньше этого запаса — обновляем до запроса, а не ждём 401. */
export const ACCESS_REFRESH_AHEAD_MS = 60_000;

/** Сессии нет (выход, сервер её не знает): гард уже ведёт на «Вход». */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

const isUnauthorized = (error: unknown) => error instanceof ApiHttpError && error.status === 401;

/** Обновление access, общее для всех запросов: параллельные запросы ждут одну ротацию refresh. */
let inflight: Promise<'rotated' | 'signedOut'> | null = null;

/**
 * Single-flight обновление access (ADR-0008, R2): ротация — только `refreshAccess` платформы под замком сессии;
 * итог — в стор (новая сессия или локальный выход с `returning`). Сеть, 429, 5xx — бросает (не выход).
 */
function refreshOnce(): Promise<'rotated' | 'signedOut'> {
  if (!inflight) {
    const checked = useSessionStore.getState().session;
    inflight = refreshAccess(Date.now())
      .then((result) => {
        useSessionStore.getState().applyAccessRefresh(checked, result);
        return result.status;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function refreshedAccess(): Promise<string> {
  const status = await refreshOnce();
  const session = useSessionStore.getState().session;
  if (status === 'signedOut' || !session) throw new UnauthorizedError();
  return session.accessToken;
}

async function currentAccess(): Promise<string> {
  const session = useSessionStore.getState().session;
  if (!session) throw new UnauthorizedError();
  const left = Date.parse(session.accessTokenExpiresAt) - Date.now();
  return left < ACCESS_REFRESH_AHEAD_MS ? refreshedAccess() : session.accessToken;
}

/**
 * Запрос, требующий входа: access из стора (истекает в ближайшие 60 с — сначала обновление); ответ 401 — одно
 * обновление и один повтор (другой запрос мог уже обновить access — тогда повтор с ним, без второй ротации).
 * Refresh 401 — локальный выход, `UnauthorizedError`. Сеть, 429, 5xx обновления — ошибка запроса, сессия остаётся.
 */
export async function withAccessToken<T>(call: (accessToken: string) => Promise<T>): Promise<T> {
  const used = await currentAccess();
  try {
    return await call(used);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    const current = useSessionStore.getState().session;
    const next =
      current && current.accessToken !== used ? current.accessToken : await refreshedAccess();
    return call(next);
  }
}
