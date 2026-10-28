import { RIDE_NEAR_RADIUS_KM } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { haversineMeters } from '@pokatim/tracks';

/*
 * «Рядом» (05c, ADR-0014 поправка 05c): позиция пользователя — одно foreground-чтение по нажатию, округлённое до
 * 0,01° (~1 км). Живёт только в памяти вкладки и в замыкании запроса ленты: не в ключах и данных TanStack Query, не в
 * persist, `console.*`, URL и подписях a11y. Расстояние «в N км от вас» — расчёт на клиенте.
 */

export type LngLat = readonly [number, number];

/** Состояние «Рядом» вкладки: `seq` — счётчик нажатия (он, а не координаты, — в ключе запроса). */
export interface NearQuery {
  seq: number;
  lngLat: LngLat;
}

/** Радиус «Рядом», км — без настройки в UI (A5). */
export const NEAR_RADIUS_KM = RIDE_NEAR_RADIUS_KM.default;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Позиция до 0,01° — дальше экрана точнее не уходит. */
export const roundNear = ([lon, lat]: LngLat): [number, number] => [round2(lon), round2(lat)];

/** Параметр `near` запроса: «<lat>,<lon>», два знака. */
export const nearParam = ([lon, lat]: LngLat) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

/** «в 12 км от вас» / «меньше 1 км от вас»; нет старта (райд без маршрута) или позиции — `null`. */
export function distanceLabel(me: LngLat | null, start: LngLat | null): string | null {
  if (!me || !start) return null;
  const km = haversineMeters({ lon: me[0], lat: me[1] }, { lon: start[0], lat: start[1] }) / 1000;
  return km < 1 ? t('rides.nearUnderKm') : t('rides.nearDistance', { distance: Math.round(km) });
}
