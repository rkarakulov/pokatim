/**
 * Ключи признаков сессии web в `localStorage` (общие для вкладок, `session-persistence.web.ts`): незавершённый выход и
 * «сессии нет». Отдельно от модуля сессии — их читают и офлайн-копии билетов (выход в соседней вкладке).
 */
export const SIGN_OUT_PENDING_KEY = 'pokatim.signOutPending';
export const NO_SESSION_KEY = 'pokatim.noSession';
