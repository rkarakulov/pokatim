import * as Location from 'expo-location';

/**
 * Разрешение геопозиции «при использовании» (foreground). `unavailable` — модуль или служба недоступны: шаг
 * онбординга пропускается. Web — `location-permission.web.ts` (Geolocation API, без `expo-location`).
 */
export type LocationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

const fromStatus = (status: Location.PermissionStatus | string): LocationPermission => {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
};

/**
 * Native (`expo-location`): единственный импорт модуля в приложении. Координаты не запрашиваются и не читаются —
 * только статус разрешения (Q6; координаты понадобятся фиче «рядом»).
 */
export async function getLocationPermission(): Promise<LocationPermission> {
  try {
    return fromStatus((await Location.getForegroundPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}

/** Системный диалог разрешения (точность — выбор пользователя в диалоге ОС, Q8). Не бросает. */
export async function requestLocationPermission(): Promise<LocationPermission> {
  try {
    return fromStatus((await Location.requestForegroundPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}
