import type { LonLat, RouteMapGeometry } from '@pokatim/contracts';
import { localProjection } from '@pokatim/tracks';

/*
 * Геометрия линии без карты: разрез по дробным позициям разметки трека (maps-02: `trackMap`, позиции `i + t`) и
 * вписывание линии в прямоугольник (контур героя Главной, линия карточки для сторис). Приложение и API.
 */

/** Точка линии в дробной позиции `i + t`. */
export function pointAt(line: readonly LonLat[], position: number): LonLat {
  const i = Math.floor(position);
  const a = line[i]!;
  const b = line[i + 1];
  const t = position - i;
  if (b === undefined || t === 0) return a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Участок линии между позициями (зажаты в `[0, n − 1]`); пустой — `null`. */
export function sliceLine(line: readonly LonLat[], from: number, to: number): LonLat[] | null {
  const last = line.length - 1;
  if (last < 0) return null;
  const a = Math.max(0, Math.min(last, from));
  const b = Math.max(0, Math.min(last, to));
  if (!(b > a)) return null;
  const result: LonLat[] = [pointAt(line, a)];
  for (let i = Math.floor(a) + 1; i < b; i += 1) result.push(line[i]!);
  result.push(pointAt(line, b));
  return result;
}

/** Единицы `viewBox` (не px): контур растягивается по блоку с сохранением пропорций (`xMidYMid meet`). */
export interface ContourView {
  width: number;
  height: number;
  /** поле вокруг контура, единицы `viewBox` */
  padding: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Путь SVG контура линии (app-themes C2, герой Главной; карточка для сторис): локальная проекция вокруг центральной
 * широты рамки (`localProjection`, как у карты), вписывание в `view` с полями и сохранением пропорций, север — вверху.
 * Возвращает путь `M…L…`, точки пути и точку старта (первая точка линии); вырожденная рамка (все точки в одной) — `null`.
 */
export function contourPath(
  line: RouteMapGeometry['line'],
  bounds: RouteMapGeometry['bounds'],
  view: ContourView,
): { d: string; points: [number, number][]; start: [number, number] } | null {
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
  return { d: `M${xy.map(([x, y]) => `${x},${y}`).join('L')}`, points: xy, start: xy[0]! };
}
