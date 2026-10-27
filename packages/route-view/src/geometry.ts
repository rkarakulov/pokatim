import type { LonLat, RaceRouteMap, RouteMapGeometry } from '@pokatim/contracts';
import { boundsOf } from '@pokatim/tracks';

/**
 * Геометрия маршрута каталога (без коридора) → тип пропса `RouteMap.map` приложения (RC-5). `widthM: 0` не
 * показывается и не влияет на карту: вызывающий передаёт `corridor={false}`, слоя коридора нет.
 */
export function withoutCorridor(geometry: RouteMapGeometry): RaceRouteMap {
  return { ...geometry, widthM: 0 };
}

/**
 * Геометрия карты из одной линии показа (панель, routes-05 RC-5: `PanelRoute` даёт только `line`): рамка — по
 * точкам линии, старт и финиш — её концы. Меньше двух точек или рамка в точку (все точки совпадают) — `null`:
 * карты нет.
 */
export function geometryFromLine(line: readonly LonLat[]): RouteMapGeometry | null {
  const bounds = boundsOf(line);
  const start = line[0];
  const finish = line.at(-1);
  if (line.length < 2 || !bounds || !start || !finish) return null;
  if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) return null;
  return {
    line: line.map(([lon, lat]) => [lon, lat] as LonLat),
    start: [start[0], start[1]],
    finish: [finish[0], finish[1]],
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
  };
}
