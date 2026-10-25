import { type AnySession, CookieSession } from '@pokatim/contracts';
import { create } from 'zustand';

import { isSessionAlive } from './session-expiry';
import { clearSession, restoreSession, revalidateSession } from './session-persistence';
import type { AccessRefresh } from './session-revalidation';

/**
 * `unknown` — до восстановления сессии при запуске (native: SecureStore; web: refresh по cookie);
 * `unavailable` — проверить не удалось (web: 429, сеть, сбой API после повторов): не выход, повтор — `hydrate()`
 */
export type SessionStatus = 'unknown' | 'unavailable' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  /** общая часть native и web: access и сроки; refresh на web — только в httpOnly cookie */
  session: CookieSession | null;
  /** причина `unavailable` — «Нет соединения» или «Не удалось загрузить» */
  restoreError: unknown;
  /** на устройстве уже входили (явный выход или отзыв сессии сервером): гард ведёт на «Вход», а не «Регистрацию» */
  returning: boolean;
  hydrate: (now?: number) => Promise<void>;
  /** фоновая проверка сессии сервером (native: ротация refresh; web — уже при восстановлении) */
  revalidate: (now?: number) => Promise<void>;
  signIn: (session: AnySession) => Promise<void>;
  signOut: () => Promise<void>;
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

type Restored = Pick<SessionState, 'status' | 'session' | 'restoreError'>;

async function restore(now: number): Promise<Restored> {
  try {
    const session = await restoreSession(now);
    // в памяти — без refresh (native: он только в SecureStore)
    return session
      ? { status: 'signedIn', session: CookieSession.parse(session), restoreError: null }
      : { status: 'signedOut', session: null, restoreError: null };
  } catch (error) {
    // native не бросает; web — временный сбой после повторов: сессия, может быть, жива — не выход
    return { status: 'unavailable', session: null, restoreError: error };
  }
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  status: 'unknown',
  session: null,
  restoreError: null,
  returning: false,
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
    set({ status: 'signedIn', session: CookieSession.parse(session) });
  },
  signOut: async () => {
    await clearSession();
    set({ status: 'signedOut', session: null, returning: true });
  },
  applyAccessRefresh: (checked, result) => {
    set((state) => {
      if (state.session !== checked || state.status !== 'signedIn') return state;
      return result.status === 'rotated'
        ? { session: CookieSession.parse(result.session) }
        : { status: 'signedOut', session: null, returning: true };
    });
  },
}));

/** Для тестов: состояние «только что запущено». */
export const resetSessionStore = () =>
  useSessionStore.setState({
    status: 'unknown',
    session: null,
    restoreError: null,
    returning: false,
  });
