/**
 * Web приложения райдера (сброс пароля — общий, слайс 3): на стенде и в проде — тот же origin (`''`), в `pnpm dev`
 * — `VITE_APP_WEB_URL` (web приложения на своём порту).
 */
const appWebUrl = (import.meta.env.VITE_APP_WEB_URL ?? '').replace(/\/+$/, '');

/** «Забыли пароль?» — экран запроса ссылки сброса в web приложения. */
export const FORGOT_PASSWORD_URL = `${appWebUrl}/forgot-password`;
