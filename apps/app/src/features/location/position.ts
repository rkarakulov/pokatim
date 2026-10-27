/*
 * Одно чтение позиции по нажатию «Моё местоположение» (routes-04d, G1, RC-12): тип результата и сроки — общие для
 * `current-position.ts` (native, `expo-location`) и `current-position.web.ts` (Geolocation API). Отдельный файл без
 * импортов: web-вариант не тянет `expo-location` в бандл.
 */

/** Результат чтения. Координаты — только в памяти вызывающего: не логируются, не хранятся, не отправляются (G2). */
export type PositionResult =
  | { status: 'ok'; lngLat: readonly [number, number] }
  | { status: 'denied'; canOpenSettings: boolean }
  | { status: 'unavailable' };

/** Сколько ждём позицию после разрешения, мс (native — свой таймер: у `getCurrentPositionAsync` таймаута нет). */
export const LOCATE_TIMEOUT_MS = 15_000;

/** Web: позиция не старше, мс — повторное нажатие не будит GPS заново. */
export const LOCATE_MAX_AGE_MS = 60_000;

export const POSITION_UNAVAILABLE: PositionResult = { status: 'unavailable' };
