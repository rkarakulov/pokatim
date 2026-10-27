import type { RouteMapGeometry } from '@pokatim/contracts';
import { localProjection } from '@pokatim/tracks';

/** Единицы `viewBox` (не px): контур растягивается по блоку с сохранением пропорций (`xMidYMid meet`). */
export interface ContourView {
  width: number;
  height: number;
  /** поле вокруг контура, единицы `viewBox` */
  padding: number;
}

/** viewBox контура героя Главной: пропорция ≈ панели героя на телефоне. */
export const CONTOUR_VIEW: ContourView = { width: 320, height: 200, padding: 16 };

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Путь SVG контура маршрута (app-themes C2, герой Главной): локальная проекция вокруг центральной широты рамки
 * (`localProjection`, как у карты), вписывание в `view` с полями и сохранением пропорций, север — вверху. Возвращает
 * путь `M…L…` и точку старта (первая точка линии); вырожденная рамка (все точки в одной) — `null`.
 */
export function contourPath(
  line: RouteMapGeometry['line'],
  bounds: RouteMapGeometry['bounds'],
  view: ContourView,
): { d: string; start: [number, number] } | null {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const { kx, ky } = localProjection((minLat + maxLat) / 2);
  const spanX = (maxLon - minLon) * kx;
  const spanY = (maxLat - minLat) * ky;
  if (!(spanX > 0 || spanY > 0)) return null;
  const innerX = view.width - 2 * view.padding;
  const innerY = view.height - 2 * view.padding;
  // по нулевой стороне (линия строго по меридиану или параллели) масштаб не ограничен
  const scale = Math.min(
    spanX > 0 ? innerX / spanX : Infinity,
    spanY > 0 ? innerY / spanY : Infinity,
  );
  const offsetX = view.padding + (innerX - spanX * scale) / 2;
  const offsetY = view.padding + (innerY - spanY * scale) / 2;
  const xy = line.map(
    ([lon, lat]) =>
      [
        round(offsetX + (lon - minLon) * kx * scale),
        round(offsetY + (maxLat - lat) * ky * scale),
      ] as [number, number],
  );
  return { d: `M${xy.map(([x, y]) => `${x},${y}`).join('L')}`, start: xy[0]! };
}

/** Общий API контура (`route-contour.tsx` — native, `route-contour.web.tsx` — web). */
export interface RouteContourProps {
  geometry: Pick<RouteMapGeometry, 'line' | 'bounds'>;
  /** цвет линии маршрута */
  color: string;
  /** заливка точки старта (`map.start`, контрастна к линии); обводка — цвет линии */
  startColor: string;
}

/** Радиус точки старта, единицы `viewBox` (контур вписан в `CONTOUR_VIEW`). */
export const CONTOUR_START_RADIUS = 5;
