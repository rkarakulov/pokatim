import {
  ROUTE_AUTHOR_KINDS,
  ROUTE_DISTANCE_BUCKETS,
  SURFACES,
  type CityCode,
  type RouteAuthorKind,
  type RouteDistanceBucket,
  type Surface,
} from '@pokatim/contracts';

/**
 * Фильтры вкладки «Маршруты» (D3) — состояние экрана (сбрасывается при перезапуске, в URL не попадает). Внутри группы
 * — ИЛИ, между группами — И (делает сервер, `CatalogRouteQuery`). Значения отсортированы (`toggle` из
 * `lib/filter-chips`): ключ запроса стабилен. Предела выбора нет — запрос принимает все значения справочников.
 */
export interface RouteFilters {
  city: readonly CityCode[];
  distance: readonly RouteDistanceBucket[];
  surface: readonly Surface[];
  /** routes-06 (U4): «Команда» / «Райдеры». */
  author: readonly RouteAuthorKind[];
}

export const NO_FILTERS: RouteFilters = { city: [], distance: [], surface: [], author: [] };

export const hasFilters = (filters: RouteFilters) =>
  filters.city.length > 0 ||
  filters.distance.length > 0 ||
  filters.surface.length > 0 ||
  filters.author.length > 0;

/** Чипы «Дистанция», «Покрытие», «Автор» — из справочников контрактов; «Город» — из `GET /v1/routes/cities`. */
export const DISTANCE_CHIPS = ROUTE_DISTANCE_BUCKETS;
export const SURFACE_CHIPS = SURFACES;
export const AUTHOR_CHIPS = ROUTE_AUTHOR_KINDS;

/** Снять города, которых больше нет среди чипов; `undefined` — ещё не загружено: без изменений. */
export function withinAvailable(
  filters: RouteFilters,
  cities: readonly CityCode[] | undefined,
): RouteFilters {
  return cities
    ? { ...filters, city: filters.city.filter((city) => cities.includes(city)) }
    : filters;
}
