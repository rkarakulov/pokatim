import type { AppThemeId } from '@pokatim/contracts';

/** Web: кэша нет — тему до ответа сервера даёт SSR (`window.__POKATIM_THEME__`, `initial-theme-id.web.ts`). */
export async function readCachedThemeId(): Promise<AppThemeId | null> {
  return null;
}

export async function saveCachedThemeId(_id: AppThemeId): Promise<void> {}
