import type { MessageKey } from '@pokatim/i18n';

/** Web (routes-04d, RC-14): открыть настройки браузера из страницы нельзя — вызов ничего не делает. */
export async function openLocationSettings(): Promise<void> {}

/** Текст отказа на web — разрешить в настройках браузера (без ссылки). */
export function locationDeniedMessage(_canOpenSettings: boolean): MessageKey {
  return 'maps.location.deniedBrowser';
}
