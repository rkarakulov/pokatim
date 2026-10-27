import { SCRUB_LOOP_TOLERANCE_M, type Planar } from '@pokatim/tracks';

/*
 * Геометрия оверлея маркера скраббинга (routes-04, RC-2): линия показа в пикселях вида карты. Доля ↔ точка и
 * ближайшая точка — `@pokatim/tracks` (`pointAtFraction`, `nearestFraction`), здесь — только проекция и допуск.
 */

const mercatorY = (lat: number) => {
  const rad = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
};

/**
 * Проекция `[lon, lat]` → пиксели вида по видимой рамке `[запад, юг, восток, север]` и размеру вида (native: рамка —
 * `ViewState.bounds` последнего события региона, пересчёт на каждое движение камеры, routes-04b). Web Mercator: по долготе линейно, по широте — `ln tan`.
 */
export function mercatorProjector(
  bounds: readonly [west: number, south: number, east: number, north: number],
  width: number,
  height: number,
): (lonLat: readonly [number, number]) => Planar {
  const [west, south, east, north] = bounds;
  const top = mercatorY(north);
  const spanX = east - west || 1;
  const spanY = top - mercatorY(south) || 1;
  return ([lon, lat]) => [
    ((lon - west) / spanX) * width,
    ((top - mercatorY(lat)) / spanY) * height,
  ];
}

/**
 * Нижняя граница допуска «равных расстояний», px вида (ревью pass 1, M3): на обзорном зуме 15 м — доли пикселя, а два
 * прохода одной дороги (упрощение, GPS) расходятся на 20–40 м — визуально одна линия; без границы палец «прыгал» бы
 * между проходами. Порядок — четверть области касания.
 */
export const SCRUB_TOLERANCE_MIN_PX = 12;

/**
 * Допуск «равных расстояний» петли в единицах вида: `SCRUB_LOOP_TOLERANCE_M` по отношению длины линии в px и м, не
 * меньше `SCRUB_TOLERANCE_MIN_PX`.
 */
export function scrubTolerance(points: readonly Planar[], cumulative: readonly number[]): number {
  const total = cumulative.at(-1) ?? 0;
  if (points.length < 2 || total <= 0) return SCRUB_TOLERANCE_MIN_PX;
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return Math.max(SCRUB_TOLERANCE_MIN_PX, (SCRUB_LOOP_TOLERANCE_M * length) / total);
}

/**
 * Пиксели линии `[lon, lat]` по проекции камеры (routes-04): одна функция пересчёта для оверлея маркера — вызывается
 * на любое изменение камеры (web — `map.project` на `load`/`resize`/`move`, native — `mercatorProjector` по рамке
 * событий региона и размеру вида; routes-04b — интерактивная камера, оверлей тот же).
 */
export function projectLine(
  line: readonly (readonly [number, number])[],
  project: (lonLat: [lon: number, lat: number]) => Planar,
): Planar[] {
  return line.map(([lon, lat]) => project([lon, lat]));
}
