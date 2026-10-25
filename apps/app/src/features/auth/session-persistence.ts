import { ApiHttpError } from '@pokatim/api-client';
import { type AnySession, type CookieSession, Session } from '@pokatim/contracts';

import { api } from '@/lib/api';

import { readJson } from './read-json';
import { secureStorage } from './secure-storage';
import type { AccessRefresh, Revalidation } from './session-revalidation';
import { isSessionAlive } from './session-expiry';
import { withSessionLock } from './session-lock';

/**
 * Native: сессия целиком (с refresh) — в SecureStore, как до F5b. Web — `session-persistence.web.ts`
 * (refresh в httpOnly cookie, access в памяти). Стор сессии знает только эти операции.
 */
const KEY = 'pokatim.session';

const readStored = (now: number) =>
  readJson(KEY, (value) => {
    const parsed = Session.safeParse(value);
    return parsed.success && isSessionAlive(parsed.data, now) ? parsed.data : undefined;
  });

/**
 * Сессия прошлого запуска — локально, без сети: офлайн-старт на прогулке не выходит из аккаунта (R5). Просроченная
 * или битая удаляется. Не бросает. Сервер её проверяет потом — `revalidateSession`.
 */
export function restoreSession(now: number): Promise<CookieSession | undefined> {
  return readStored(now);
}

/**
 * Сохранить сессию (сразу, ещё до входа: закрытие приложения в «E-mail подтверждён» вход не теряет).
 * Никогда не бросает: токен регистрации уже обменян, повторно сессию не получить — сбой Keychain/Keystore
 * не блокирует вход (сессия живёт в памяти до перезапуска).
 */
export async function persistSession(session: AnySession): Promise<boolean> {
  // native просит сессию в теле (транспорт body): без refresh сохранять нечего
  const full = Session.safeParse(session);
  if (!full.success) {
    console.warn('session not persisted: no refresh token');
    return false;
  }
  try {
    await secureStorage.set(KEY, JSON.stringify(full.data));
    return true;
  } catch (error) {
    console.warn(`session not persisted: ${(error as Error).name}`);
    return false;
  }
}

async function forget(): Promise<void> {
  try {
    await secureStorage.delete(KEY);
  } catch (error) {
    console.warn(`session not cleared: ${(error as Error).name}`);
  }
}

const isUnauthorized = (error: unknown) => error instanceof ApiHttpError && error.status === 401;

/**
 * Ответ сервера получен целиком: ошибка с HTTP-статусом (`ApiHttpError`). Всё прочее — запрос не дошёл или ответ
 * не дочитан: обрыв при чтении тела 2xx клиент API отдаёт как ошибку разбора (тело `undefined`), а сервер мог уже
 * ротировать refresh.
 */
const isResponseReceived = (error: unknown) => error instanceof ApiHttpError;

/**
 * Ротация с одной немедленной повторной попыткой, если корректный ответ не получен (сеть, обрыв тела) — в пределах
 * окна повтора сервера (60 с) прежний refresh ещё действует.
 */
async function rotate(refreshToken: string) {
  try {
    return await api.refreshSession({ refreshToken });
  } catch (error) {
    if (isResponseReceived(error)) throw error;
    return api.refreshSession({ refreshToken });
  }
}

/**
 * Ротация сохранённого refresh: новый — в SecureStore. 401 (выход в другом месте, reuse, истекла) — сессия забыта,
 * `signedOut`. Прочее (сеть после повтора, 429, 5xx) — бросает. Вызывается под замком сессии.
 */
async function rotateStored(stored: Session): Promise<AccessRefresh> {
  try {
    const session = Session.parse(await rotate(stored.refreshToken));
    // сбой записи — предупреждение без токена: следующий запуск вне окна повтора → вход заново (принято)
    await persistSession(session);
    return { status: 'rotated', session };
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    await forget();
    return { status: 'signedOut' };
  }
}

/**
 * Фоновая проверка сессии после локального восстановления (R5): ротация refresh по телу, новый — в SecureStore.
 * 401 (выход в другом месте, reuse, истекла) — сессия забыта, `signedOut`. Сеть, 429, сбой сервера — остаёмся в
 * аккаунте (`unchanged`). Под замком сессии: выход во время ротации ждёт её. Не бросает.
 */
export function revalidateSession(now: number): Promise<Revalidation> {
  return withSessionLock(async (): Promise<Revalidation> => {
    const stored = await readStored(now);
    if (!stored) return { status: 'unchanged' };
    return rotateStored(stored).catch((): Revalidation => ({ status: 'unchanged' }));
  });
}

/**
 * Новый access для авторизованного запроса (`withAccessToken`, ADR-0008): та же ротация refresh под замком сессии,
 * что и `revalidateSession`. Сохранённой сессии нет (выход, сбой записи SecureStore) — обновить нечем: `signedOut`.
 * Сеть, 429, 5xx — бросает: ошибка запроса, не выход.
 */
export function refreshAccess(now: number): Promise<AccessRefresh> {
  return withSessionLock(async (): Promise<AccessRefresh> => {
    const stored = await readStored(now);
    if (!stored) return { status: 'signedOut' };
    return rotateStored(stored);
  });
}

/**
 * Выход: сервер отзывает сессию (refresh из SecureStore), затем она забывается на устройстве. Под замком сессии —
 * после идущей ротации, уже с новым refresh. Не бросает: офлайн или сбой сервера — локальный выход всё равно.
 */
export function clearSession(): Promise<void> {
  return withSessionLock(async () => {
    const stored = await readJson(KEY, (value) => {
      const parsed = Session.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    });
    if (stored) {
      try {
        await api.signOut({ refreshToken: stored.refreshToken });
      } catch (error) {
        console.warn(`sign-out failed: ${(error as Error).name}`);
      }
    }
    await forget();
  });
}
