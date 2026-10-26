import type { RaceRouteMap, RouteMapGeometry } from '@pokatim/contracts';

/**
 * Геометрия маршрута каталога (без коридора) → тип пропса `RouteMap.map` (RC-5). `widthM: 0` не показывается и не
 * влияет на карту: вызывающий передаёт `corridor={false}`, слоя коридора нет.
 */
export function withoutCorridor(geometry: RouteMapGeometry): RaceRouteMap {
  return { ...geometry, widthM: 0 };
}
