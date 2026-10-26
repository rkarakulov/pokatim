import {
  RIDE_CITY_FILTER_MAX,
  utcToMinskWallTime,
  type CityCode,
  type RideCard,
} from '@pokatim/contracts';

import { toggle } from '@/lib/filter-chips';

import { cityLabel } from './format';

/**
 * Фильтр «Город» вкладки «Райды» — состояние экрана (сбрасывается при перезапуске, в URL не попадает). Внутри
 * группы — ИЛИ (делает сервер, `RideListQuery`). Значения отсортированы (`toggle`): ключ запроса стабилен.
 */
export interface RideFilters {
  city: readonly CityCode[];
}

export const NO_FILTERS: RideFilters = { city: [] };

export const hasFilters = (filters: RideFilters) => filters.city.length > 0;

/** `toggle` с пределом запроса (12 городов) — 13-й не добавляется. */
export function toggleCity(list: readonly CityCode[], value: CityCode): CityCode[] {
  if (!list.includes(value) && list.length >= RIDE_CITY_FILTER_MAX) return [...list];
  return toggle(list, value);
}

/** Снять города, которых больше нет среди чипов; `undefined` — ещё не загружено: без изменений. */
export function withinAvailable(
  filters: RideFilters,
  cities: readonly CityCode[] | undefined,
): RideFilters {
  return cities ? { city: filters.city.filter((city) => cities.includes(city)) } : filters;
}

/** Чипы городов — по алфавиту подписи (сервер отдаёт коды). */
export function sortCitiesByLabel(cities: readonly CityCode[]): CityCode[] {
  return [...cities].sort((a, b) => (cityLabel(a) ?? a).localeCompare(cityLabel(b) ?? b, 'ru'));
}

export type RideFeedRow =
  { kind: 'day'; day: string; startsAt: string } | { kind: 'ride'; ride: RideCard };

/** Плоские элементы списка: подпись дня по Минску — при его смене между соседними райдами (поперёк страниц). */
export function groupByDay(items: readonly RideCard[]): RideFeedRow[] {
  const rows: RideFeedRow[] = [];
  let current: string | null = null;
  for (const ride of items) {
    const day = utcToMinskWallTime(ride.startsAt).slice(0, 10);
    if (day !== current) {
      rows.push({ kind: 'day', day, startsAt: ride.startsAt });
      current = day;
    }
    rows.push({ kind: 'ride', ride });
  }
  return rows;
}
