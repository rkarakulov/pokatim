import * as Location from 'expo-location';

import { LOCATE_TIMEOUT_MS, POSITION_UNAVAILABLE, type PositionResult } from './position';

export type { PositionResult } from './position';

/** Ответ промиса или `null` по истечении `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Native (`expo-location`, routes-04d, G1, RC-12): одно foreground-чтение позиции по нажатию «Моё местоположение»,
 * без слежения. Разрешения нет, но спросить можно — системный диалог (pre-permission экран был в онбординге); отказ
 * навсегда — `canOpenSettings` (ссылка в настройки ОС). Точность — средняя (`Balanced`), ожидание — не дольше
 * `LOCATE_TIMEOUT_MS`. Не бросает; координаты не логируются.
 */
export async function readCurrentPosition(): Promise<PositionResult> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted' && permission.canAskAgain !== false) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (permission.status !== 'granted') {
      return { status: 'denied', canOpenSettings: permission.canAskAgain === false };
    }
    const position = await within(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      LOCATE_TIMEOUT_MS,
    );
    if (!position) return POSITION_UNAVAILABLE;
    return { status: 'ok', lngLat: [position.coords.longitude, position.coords.latitude] };
  } catch {
    return POSITION_UNAVAILABLE;
  }
}
