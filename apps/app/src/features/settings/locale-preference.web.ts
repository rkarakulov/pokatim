import { i18n } from '@pokatim/i18n';

import { LOCALE_KEY, supportedLocale } from './locale';

/**
 * Web: язык интерфейса — в `localStorage` (переживает вкладки, перезапуск браузера и выход). SSR рисует базовый язык;
 * сохранённый применяется на клиенте после монтирования. Приватный режим, запрет хранилища — язык по умолчанию.
 */
export async function restoreLocale(): Promise<void> {
  try {
    const raw = globalThis.localStorage?.getItem(LOCALE_KEY);
    const locale = raw ? supportedLocale(JSON.parse(raw)) : undefined;
    if (locale !== undefined) i18n.setLocale(locale);
  } catch {
    // битое значение или недоступное хранилище — язык по умолчанию
  }
}

export async function saveLocale(locale: string): Promise<void> {
  i18n.setLocale(locale);
  try {
    globalThis.localStorage?.setItem(LOCALE_KEY, JSON.stringify(locale));
  } catch (error) {
    console.warn(`localStorage unavailable: ${(error as Error).name}`);
  }
}
