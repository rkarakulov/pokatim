import { AppThemeId } from '@pokatim/contracts';

import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

const KEY = 'pokatim.appTheme';

/**
 * Тема с прошлого запуска (native): подсказка до ответа профиля, чтобы запуск сразу шёл в своей теме. Значение не
 * секретное; хранилище — SecureStore (другой KV-зависимости нет). Битое — удаляется, `null`. Web — `.web.ts` (cookie).
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

/** Выход и «Классика» (user-theme, RC-2/RC-8): ключ удаляется — запуск без него идёт в «Классике». */
export async function clearCachedThemeId(): Promise<void> {
  try {
    await secureStorage.delete(KEY);
  } catch (error) {
    console.warn(`app theme not cleared: ${(error as Error).name}`);
  }
}
