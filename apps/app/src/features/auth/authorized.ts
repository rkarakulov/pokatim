import { ApiHttpError } from '@pokatim/api-client';
import type { CookieSession } from '@pokatim/contracts';

import { accessClaims, isSameSession } from './session-identity';
import { refreshAccess } from './session-persistence';
import { useSessionStore } from './session-store';

/** Access истекает раньше этого запаса — обновляем до запроса, а не ждём 401. */
export const ACCESS_REFRESH_AHEAD_MS = 60_000;

/** Сессии нет (выход, сервер её не знает) или за время запроса она сменилась: гард уже ведёт на «Вход» / дальше. */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

const isUnauthorized = (error: unknown) => error instanceof ApiHttpError && error.status === 401;

/** Обновление access, общее для всех запросов: параллельные запросы ждут одну ротацию refresh. */
let inflight: Promise<void> | null = null;

/**
 * Single-flight обновление access (ADR-0008, R2): ротация — только `refreshAccess` платформы под замком сессии;
 * итог — в стор (новая сессия той же учётной записи или локальный выход). Сеть, 429, 5xx — бросает (не выход).
 */
function refreshOnce(): Promise<void> {
  if (!inflight) {
    const checked = useSessionStore.getState().session;
    inflight = refreshAccess(Date.now())
      .then((result) => useSessionStore.getState().applyAccessRefresh(checked, result))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Остаток жизни access (мс). Сессия получена от сервера в этом процессе — по сроку жизни `exp − iat` сервера от
 * момента получения (часы устройства могут спешить или отставать); из хранилища — по `accessTokenExpiresAt`.
 */
function accessLeftMs(session: CookieSession, receivedAt: number | null, now: number): number {
  const claims = accessClaims(session.accessToken);
  if (receivedAt !== null && claims?.iat !== undefined && claims.exp !== undefined) {
    return receivedAt + (claims.exp - claims.iat) * 1000 - now;
  }
  return Date.parse(session.accessTokenExpiresAt) - now;
}

/**
 * Запрос, требующий входа: access из стора (истекает в ближайшие 60 с — сначала обновление); ответ 401 — одно
 * обновление и один повтор (другой запрос мог уже обновить access — тогда повтор с ним, без второй ротации).
 * Сессия (`sub` + `sid`) фиксируется в начале и сверяется после каждого ожидания: вышли или вошли другим аккаунтом —
 * `UnauthorizedError`, ни повтора, ни результата от имени другой сессии. Refresh 401 — локальный выход.
 * Сеть, 429, 5xx обновления — ошибка запроса, сессия остаётся.
 */
export async function withAccessToken<T>(call: (accessToken: string) => Promise<T>): Promise<T> {
  const started = useSessionStore.getState().session;
  if (!started) throw new UnauthorizedError();
  /** Текущая сессия — та же, что в начале операции; иначе операция прекращается. */
  const current = (): CookieSession => {
    const session = useSessionStore.getState().session;
    if (!session || !isSameSession(session, started)) throw new UnauthorizedError();
    return session;
  };
  const refreshed = async () => {
    await refreshOnce();
    return current().accessToken;
  };

  const { sessionReceivedAt } = useSessionStore.getState();
  const used =
    accessLeftMs(started, sessionReceivedAt, Date.now()) < ACCESS_REFRESH_AHEAD_MS
      ? await refreshed()
      : current().accessToken;

  let result: T;
  try {
    result = await call(used);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    const session = current();
    const next = session.accessToken !== used ? session.accessToken : await refreshed();
    result = await call(next);
  }
  // ответ относится к сессии начала операции: за это время вышли или вошли другим — результат не применяется
  current();
  return result;
}
