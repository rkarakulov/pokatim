import { i18n } from '@pokatim/i18n';

/** Ключ языка на устройстве (Keychain / Keystore допускают только `[A-Za-z0-9._-]`). */
export const LOCALE_KEY = 'pokatim.locale';

/** Сохранённое значение — язык из `i18n.locales`; чужое (язык убрали из сборки, мусор) — `undefined`. */
export function supportedLocale(value: unknown): string | undefined {
  return typeof value === 'string' && i18n.locales.includes(value) ? value : undefined;
}
