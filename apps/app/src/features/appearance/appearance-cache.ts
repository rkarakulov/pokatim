import { AppThemeId } from '@pokatim/contracts';

import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

const KEY = 'pokatim.appTheme';

/**
 * Тема с прошлого запуска (native): подсказка до ответа сервера, чтобы запуск сразу шёл в своей теме. Значение не
 * секретное; хранилище — SecureStore (другой KV-зависимости нет). Битое — удаляется, `null`. Web — `.web.ts`.
 */
export async function readCachedThemeId(): Promise<AppThemeId | null> {
  const id = await readJson(KEY, (value) => AppThemeId.safeParse(value).data);
  return id ?? null;
}

export async function saveCachedThemeId(id: AppThemeId): Promise<void> {
  try {
    await secureStorage.set(KEY, JSON.stringify(id));
  } catch (error) {
    console.warn(`app theme not persisted: ${(error as Error).name}`);
  }
}
