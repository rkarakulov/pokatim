import type { LocationPermission } from './location-permission';

/**
 * Web (R10): Geolocation API напрямую, без `expo-location` (его web-вариант бросает без Permissions API и на таймаут
 * отдаёт `granted: false` со статусом `granted`). Координаты не читаются: успех запроса — только факт разрешения.
 * SSR (нет `navigator`) и небезопасный контекст (http не на localhost) — `unavailable`.
 */

function geolocation(): Geolocation | undefined {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return undefined;
  if (window.isSecureContext === false) return undefined;
  return navigator.geolocation ?? undefined;
}

/** Состояние из Permissions API; нет API (старые Safari) или сбой — `undefined`. */
async function queryPermission(): Promise<PermissionState | undefined> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return status?.state;
  } catch {
    return undefined;
  }
}

const fromState = (state: PermissionState): LocationPermission =>
  state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'undetermined';

export async function getLocationPermission(): Promise<LocationPermission> {
  if (!geolocation()) return 'unavailable';
  const state = await queryPermission();
  // без Permissions API решение неизвестно — экран покажется, флаг устройства закроет его потом
  return state ? fromState(state) : 'undetermined';
}

/**
 * Запрос разрешения браузера: единственный способ — `getCurrentPosition`; позиция из колбэка отбрасывается
 * нетронутой. Итог — по Permissions API, если он есть (таймаут не значит отказ); иначе — по колбэку.
 */
export async function requestLocationPermission(): Promise<LocationPermission> {
  const geo = geolocation();
  if (!geo) return 'unavailable';
  const outcome = await new Promise<LocationPermission>((resolve) => {
    try {
      geo.getCurrentPosition(
        () => resolve('granted'),
        (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : 'undetermined'),
        { maximumAge: Infinity, timeout: 30_000, enableHighAccuracy: false },
      );
    } catch {
      resolve('unavailable');
    }
  });
  const state = await queryPermission();
  return state ? fromState(state) : outcome;
}
