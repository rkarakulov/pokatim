import type { MessageKey } from '@pokatim/i18n';
import { Linking } from 'react-native';

/**
 * Настройки ОС после отказа в геопозиции (routes-04d, RC-12, RC-14): native — `Linking.openSettings()` (экран
 * приложения в настройках). Web — `location-settings.web.ts` (ссылки нет). Не бросает.
 */
export async function openLocationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // настроек нет (симулятор без приложения настроек) — сообщение остаётся
  }
}

/** Текст отказа: отказ навсегда — «нажмите, чтобы открыть настройки» (весь баннер — ссылка), иначе — просто отказ. */
export function locationDeniedMessage(canOpenSettings: boolean): MessageKey {
  return canOpenSettings ? 'maps.location.deniedSettings' : 'maps.location.denied';
}
