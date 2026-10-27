import { PROMPT_WAIT_MS } from './location-permission.web';
import {
  LOCATE_MAX_AGE_MS,
  LOCATE_TIMEOUT_MS,
  POSITION_UNAVAILABLE,
  type PositionResult,
} from './position';

/**
 * Web (routes-04d, G4, RC-12): Geolocation API напрямую, без `expo-location`. `getCurrentPosition` вызывается
 * синхронно первым действием (до любого `await`) — Safari показывает запрос только из обработчика нажатия; Permissions
 * API до вызова не опрашивается. Отказ — `denied` без ссылки (настройки браузера — текстом). Нет API, SSR,
 * небезопасный контекст (http не на localhost) — `unavailable`. Ожидание ответа пользователя — не дольше
 * `PROMPT_WAIT_MS` (`timeout` Geolocation его не покрывает). Не бросает; координаты не логируются.
 */
export function readCurrentPosition(): Promise<PositionResult> {
  const geo =
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    window.isSecureContext === false
      ? undefined
      : navigator.geolocation;
  if (!geo) return Promise.resolve(POSITION_UNAVAILABLE);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(POSITION_UNAVAILABLE), PROMPT_WAIT_MS);
    const settle = (result: PositionResult) => {
      clearTimeout(timer);
      resolve(result);
    };
    try {
      geo.getCurrentPosition(
        (position) =>
          settle({
            status: 'ok',
            lngLat: [position.coords.longitude, position.coords.latitude],
          }),
        (error) =>
          settle(
            error.code === error.PERMISSION_DENIED
              ? { status: 'denied', canOpenSettings: false }
              : POSITION_UNAVAILABLE,
          ),
        { enableHighAccuracy: false, maximumAge: LOCATE_MAX_AGE_MS, timeout: LOCATE_TIMEOUT_MS },
      );
    } catch {
      settle(POSITION_UNAVAILABLE);
    }
  });
}
