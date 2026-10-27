import { type AnySession, CookieSession } from '@pokatim/contracts';
import { create } from 'zustand';

import { isSessionAlive } from './session-expiry';
import { sessionOwner } from './session-identity';
import {
  clearSession,
  RESTORE_IS_NETWORK,
  restoreSession,
  revalidateSession,
} from './session-persistence';
import type { AccessRefresh } from './session-revalidation';

/**
 * `unknown` — до восстановления сессии при запуске (native: SecureStore; web: refresh по cookie);
 * `unavailable` — проверить не удалось (web: 429, сеть, сбой API после повторов): не выход, повтор — `hydrate()`
 */
export type SessionStatus = 'unknown' | 'unavailable' | 'signedOut' | 'signedIn';

/** Сообщение гостевому экрану после выхода: `accountDeleted` — «Аккаунт удалён» на «Регистрации». */
export type SignOutNotice = 'accountDeleted';

export interface SignOutOptions {
  /** гард ведёт на «Вход» (по умолчанию) или, `false`, на «Регистрацию» (аккаунта больше нет) */
  returning?: boolean;
  notice?: SignOutNotice;
}

interface SessionState {
  status: SessionStatus;
  /** общая часть native и web: access и сроки; refresh на web — только в httpOnly cookie */
  session: CookieSession | null;
  /** причина `unavailable` — «Нет соединения» или «Не удалось загрузить» */
  restoreError: unknown;
  /**
   * Момент получения сессии от сервера по часам устройства (мс): остаток access считается от него и срока жизни
   * `exp − iat` сервера — сдвиг часов устройства не мешает. `null` — сессия из хранилища (native-запуск): остаток — по
   * `accessTokenExpiresAt`.
   */
  sessionReceivedAt: number | null;
  /** на устройстве уже входили (явный выход или отзыв сессии сервером): гард ведёт на «Вход», а не «Регистрацию» */
  returning: boolean;
  /** только память: сообщение после выхода; снимают вход и экран, показавший его (`clearNotice`) */
  notice: SignOutNotice | null;
  hydrate: (now?: number) => Promise<void>;
  /** фоновая проверка сессии сервером (native: ротация refresh; web — уже при восстановлении) */
  revalidate: (now?: number) => Promise<void>;
  signIn: (session: AnySession) => Promise<void>;
  signOut: (options?: SignOutOptions) => Promise<void>;
  clearNotice: () => void;
  /**
   * Итог обновления access перед авторизованным запросом (`withAccessToken`) для сессии `checked`: новая сессия
   * или локальный выход без запроса отзыва (сервер сессию уже не знает). Выход или новый вход за это время не
   * затираются.
   */
  applyAccessRefresh: (checked: CookieSession | null, result: AccessRefresh) => void;
}

/** Условие гарда: есть сессия с непросроченным refresh. */
export const isSignedIn = (state: Pick<SessionState, 'status' | 'session'>, now = Date.now()) =>
  state.status === 'signedIn' && state.session !== null && isSessionAlive(state.session, now);

/** Гард пускает в вкладки и регистрацию, пока сессия не известна: вкладки показывают скелетон или повтор. */
export const isSessionPending = (status: SessionStatus) =>
  status === 'unknown' || status === 'unavailable';

type Restored = Pick<SessionState, 'status' | 'session' | 'restoreError' | 'sessionReceivedAt'>;

async function restore(now: number): Promise<Restored> {
  try {
    const session = await restoreSession(now);
    // в памяти — без refresh (native: он только в SecureStore)
    // web восстанавливает сессию запросом к серверу (получена сейчас), native — из хранилища
    const sessionReceivedAt = session && RESTORE_IS_NETWORK ? Date.now() : null;
    return session
      ? {
          status: 'signedIn',
          session: CookieSession.parse(session),
          restoreError: null,
          sessionReceivedAt,
        }
      : { status: 'signedOut', session: null, restoreError: null, sessionReceivedAt: null };
  } catch (error) {
    // native не бросает; web — временный сбой после повторов: сессия, может быть, жива — не выход
    return { status: 'unavailable', session: null, restoreError: error, sessionReceivedAt: null };
  }
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  status: 'unknown',
  session: null,
  restoreError: null,
  sessionReceivedAt: null,
  returning: false,
  notice: null,
  hydrate: async (now = Date.now()) => {
    // повтор после «не удалось» — снова «неизвестно» (скелетон)
    set((state) =>
      state.status === 'unavailable' ? { status: 'unknown', restoreError: null } : state,
    );
    const restored = await restore(now);
    // вход, случившийся пока шло восстановление (web: refresh — сетевой запрос), ответ не затирает
    set((state) => (state.status !== 'unknown' ? state : restored));
    // native: сессия восстановлена локально — сервер проверяет её в фоне (офлайн-старт остаётся в аккаунте)
    if (restored.status === 'signedIn') void get().revalidate(now);
  },
  revalidate: async (now = Date.now()) => {
    const checked = get().session;
    const result = await revalidateSession(now);
    // ответ относится только к проверенной сессии: выход или новый вход за это время не затираем
    if (result.status !== 'unchanged') get().applyAccessRefresh(checked, result);
  },
  // только память: сессию уже сохранил тот, кто её получил, — под замком сессии (`requestSignIn`, poll), иначе
  // поздняя запись SecureStore после выхода вернула бы её. В памяти — без refresh (native: он в SecureStore)
  signIn: async (session) => {
    set({
      status: 'signedIn',
      session: CookieSession.parse(session),
      sessionReceivedAt: Date.now(),
      notice: null,
    });
  },
  signOut: async ({ returning = true, notice }: SignOutOptions = {}) => {
    await clearSession();
    set({
      status: 'signedOut',
      session: null,
      sessionReceivedAt: null,
      returning,
      notice: notice ?? null,
    });
  },
  clearNotice: () => set({ notice: null }),
  applyAccessRefresh: (checked, result) => {
    set((state) => {
      if (state.session !== checked || state.status !== 'signedIn') return state;
      // web: cookie одна на браузер — другая вкладка могла войти другим аккаунтом, и refresh вернул его сессию.
      // Молча переключать вкладку на чужой аккаунт нельзя: локальный выход (онбординг и кеш запросов — сброс)
      if (result.status === 'rotated' && sessionOwner(result.session) === sessionOwner(checked)) {
        return { session: CookieSession.parse(result.session), sessionReceivedAt: Date.now() };
      }
      return { status: 'signedOut', session: null, sessionReceivedAt: null, returning: true };
    });
  },
}));

/** Для тестов: состояние «только что запущено». */
export const resetSessionStore = () =>
  useSessionStore.setState({
    status: 'unknown',
    session: null,
    restoreError: null,
    sessionReceivedAt: null,
    returning: false,
    notice: null,
  });
