import type { AppThemeId } from '@pokatim/contracts';

import { THEME_COOKIE } from './theme-cookie';

/** Срок cookie темы — год (перезаписывается при каждой смене темы профиля). */
const MAX_AGE_SEC = 365 * 24 * 3600;

function writeCookie(value: string, maxAgeSec: number): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${THEME_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

/**
 * Web: тему до ответа профиля даёт SSR (`window.__POKATIM_THEME__`, `initial-theme-id.web.ts`) — читать здесь нечего.
 */
export async function readCachedThemeId(): Promise<AppThemeId | null> {
  return null;
}

/**
 * Тема профиля — в cookie своего origin (user-theme): по ней web-сервер рендерит HTML в теме райдера без мигания.
 * Только из эффекта (не в рендере); значение — id из закрытого списка.
 */
export async function saveCachedThemeId(id: AppThemeId): Promise<void> {
  writeCookie(id, MAX_AGE_SEC);
}

/** Выход и «Классика»: cookie стирается — SSR без cookie рендерит «Классику». */
export async function clearCachedThemeId(): Promise<void> {
  writeCookie('', 0);
}
