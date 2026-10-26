import { ApiHttpError } from '@pokatim/api-client';
import { type AnySession, CookieSession } from '@pokatim/contracts';

import { api } from '@/lib/api';

import { apiErrorCode, retryAfterSec } from './error-messages';
import type { AccessRefresh, Revalidation } from './session-revalidation';
import { withSessionLock } from './session-lock';

/**
 * Web (ADR-0003 п. 4, R10 task.md F5b): refresh — только в httpOnly cookie (`SESSION_COOKIE`), его ставит
 * и ротирует API; access — только в памяти (стор). В браузерных хранилищах сессии нет. Операции, меняющие
 * cookie (refresh, выход и poll регистрации), — под одним Web Lock (`session-lock.web.ts`).
 */

/** Попыток восстановления при временном сбое (429, сеть, 5xx): первая + 2 повтора. */
const RESTORE_ATTEMPTS = 3;
/** Пауза перед повтором после сбоя сети или сервера. */
const TRANSIENT_RETRY_SEC = 2;
/** Дольше на скелетоне не ждём: 429 с большей паузой — сразу «не удалось» с кнопкой повтора. */
const MAX_RETRY_WAIT_SEC = 10;

const isUnauthorized = (error: unknown) => error instanceof ApiHttpError && error.status === 401;

/** Пауза до повтора; `undefined` — повторять сейчас бессмысленно. */
function retryDelaySec(error: unknown): number | undefined {
  if (apiErrorCode(error) !== 'RATE_LIMITED') return TRANSIENT_RETRY_SEC;
  const wait = retryAfterSec(error) ?? TRANSIENT_RETRY_SEC;
  return wait <= MAX_RETRY_WAIT_SEC ? wait : undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Web: сессия при запуске — ответ refresh от сервера (получена сейчас). */
export const RESTORE_IS_NETWORK = true;

/**
 * Сессия по cookie: `POST /v1/auth/session/refresh` без тела. 401 (нет cookie, отозвана, истекла) — «не вошёл» и
 * признак «сессии нет»: следующие запуски гостя не зовут refresh (B21 смоука dev — 401 при каждой загрузке).
 * 429, сеть, сбой сервера — не выход: повтор (429 — через `retryAfterSec`), после попыток — бросает последнюю
 * ошибку, стор показывает «сессию проверить не удалось» с повтором. Cookie при сбое не трогаем.
 */
export async function restoreSession(_now: number): Promise<CookieSession | undefined> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const restored = await withSessionLock(async () => {
        // признак — под замком: вход другой вкладки, завершившийся раньше, его уже снял, и его свежую сессию не
        // отзываем; выход, не дошедший до сервера (сеть, 5xx), — аккаунт не восстанавливаем, отзыв повторяем
        if (isSignOutPending()) {
          await revokeOnServer();
          return undefined;
        }
        if (isNoSession()) return undefined;
        try {
          const session = await api.refreshSession();
          setNoSession(false);
          return session;
        } catch (error) {
          if (isUnauthorized(error)) {
            setNoSession(true);
            return undefined;
          }
          throw error;
        }
      });
      // refreshToken в памяти web не держим, даже если сервер ответил телом
      return restored === undefined ? undefined : CookieSession.parse(restored);
    } catch (error) {
      const waitSec = retryDelaySec(error);
      if (attempt >= RESTORE_ATTEMPTS || waitSec === undefined) throw error;
      // ждём вне замка: другие вкладки тем временем не стоят в очереди
      await sleep(waitSec * 1000);
    }
  }
}

/** Web: восстановление уже было ротацией по cookie (`restoreSession`) — проверять нечего. */
export async function revalidateSession(_now: number): Promise<Revalidation> {
  return { status: 'unchanged' };
}

/**
 * Новый access для авторизованного запроса (`withAccessToken`, ADR-0008): refresh по cookie под тем же Web Lock, что
 * и прочие операции с cookie сессии. 401 или незавершённый выход — `signedOut` (cookie уже недействительна).
 * Сеть, 429, 5xx — бросает: ошибка запроса, не выход; cookie не трогаем.
 */
export function refreshAccess(_now: number): Promise<AccessRefresh> {
  return withSessionLock(async (): Promise<AccessRefresh> => {
    if (isSignOutPending()) return { status: 'signedOut' };
    try {
      // refreshToken в памяти web не держим, даже если сервер ответил телом
      return { status: 'rotated', session: CookieSession.parse(await api.refreshSession()) };
    } catch (error) {
      if (isUnauthorized(error)) {
        setNoSession(true);
        return { status: 'signedOut' };
      }
      throw error;
    }
  });
}

/**
 * Признак незавершённого выхода (в `localStorage`, общий для вкладок): выход показан, а отзыв на сервере не
 * подтверждён — httpOnly cookie JS стереть не может, и перезагрузка иначе вернула бы в аккаунт. Не токен и не данные
 * сессии. Хранилище недоступно (приватный режим, запрет) — без признака, не падаем.
 */
const SIGN_OUT_PENDING = 'pokatim.signOutPending';

function setSignOutPending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(SIGN_OUT_PENDING, '1');
    else localStorage.removeItem(SIGN_OUT_PENDING);
  } catch {
    // без хранилища — без признака
  }
}

function isSignOutPending(): boolean {
  try {
    return localStorage.getItem(SIGN_OUT_PENDING) !== null;
  } catch {
    return false;
  }
}

/**
 * Признак «сессии нет» (в `localStorage`, общий для вкладок): сервер подтвердил, что cookie сессии нет или она мертва
 * (401 восстановления или обновления access, подтверждённый отзыв). Запуск с признаком не зовёт refresh — гость не
 * получает 401 при каждой загрузке. Снимается входом и poll регистрации (`persistSession`) — только они ставят cookie.
 * Пишется только отрицательный признак: после входа в хранилищах браузера по-прежнему пусто. Не токен и не данные
 * сессии; хранилище недоступно — признака нет, refresh как раньше. Читается и пишется только под замком сессии.
 */
const NO_SESSION = 'pokatim.noSession';

function setNoSession(none: boolean): void {
  try {
    if (none) localStorage.setItem(NO_SESSION, '1');
    else localStorage.removeItem(NO_SESSION);
  } catch {
    // без хранилища — без признака
  }
}

function isNoSession(): boolean {
  try {
    return localStorage.getItem(NO_SESSION) !== null;
  } catch {
    return false;
  }
}

/** Отзыв сессии по cookie — вызывается под замком сессии; подтверждён — признак выхода снимается. Не бросает. */
async function revokeOnServer(): Promise<void> {
  try {
    await api.signOut();
    setSignOutPending(false);
    setNoSession(true);
  } catch (error) {
    console.warn(`sign-out failed: ${(error as Error).name}`);
  }
}

/**
 * Cookie уже выставил сервер (ответ входа или poll), сохранять на клиенте нечего. Вызывается внутри той же операции
 * под замком сессии, что и запрос: явный вход отменяет незавершённый выход, начатый **до** него; выход, вставший в
 * очередь позже, ставит признак уже после входа и побеждает.
 */
export async function persistSession(_session: AnySession): Promise<boolean> {
  setSignOutPending(false);
  setNoSession(false);
  return true;
}

/**
 * Выход — одна операция под замком сессии: признак незавершённого выхода, запрос отзыва, снятие признака при успехе.
 * Не бросает: локально выход состоится в любом случае; не дошёл до сервера — признак остаётся, следующий запуск не
 * восстанавливает аккаунт и повторяет отзыв.
 */
export function clearSession(): Promise<void> {
  return withSessionLock(async () => {
    setSignOutPending(true);
    await revokeOnServer();
  });
}
