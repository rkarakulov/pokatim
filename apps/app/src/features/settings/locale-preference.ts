import { i18n } from '@pokatim/i18n';

import { readJson } from '@/features/auth/read-json';
import { secureStorage } from '@/features/auth/secure-storage';

import { LOCALE_KEY, supportedLocale } from './locale';

/**
 * Язык интерфейса на устройстве (settings-hub): переживает выход — выбор устройства, не аккаунта (поля языка в профиле
 * нет). Native — SecureStore (другой KV-зависимости в проекте нет), web — `locale-preference.web.ts` (`localStorage`).
 * Сбой хранилища — не падение: язык по умолчанию.
 */
export async function restoreLocale(): Promise<void> {
  const locale = await readJson(LOCALE_KEY, supportedLocale);
  if (locale !== undefined) i18n.setLocale(locale);
}

export async function saveLocale(locale: string): Promise<void> {
  i18n.setLocale(locale);
  try {
    await secureStorage.set(LOCALE_KEY, JSON.stringify(locale));
  } catch (error) {
    console.warn(`locale not persisted: ${(error as Error).name}`);
  }
}
