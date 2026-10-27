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
 * Проекция `[lon, lat]` → пиксели вида по видимой рамке `[запад, юг, восток, север]` и размеру вида (native: камера
 * статична — рамка из `ViewState.bounds` не меняется, RC-2). Web Mercator: по долготе линейно, по широте — `ln tan`.
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

/** Допуск «равных расстояний» петли (`SCRUB_LOOP_TOLERANCE_M`) в единицах вида: по отношению длины линии в px и м. */
export function scrubTolerance(points: readonly Planar[], cumulative: readonly number[]): number {
  const total = cumulative.at(-1) ?? 0;
  if (points.length < 2 || total <= 0) return 0;
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return (SCRUB_LOOP_TOLERANCE_M * length) / total;
}

/**
 * Пиксели линии `[lon, lat]` по проекции камеры (routes-04): одна функция пересчёта для оверлея маркера — вызывается
 * на любое изменение камеры (web — `map.project` на `load`/`resize`, native — `mercatorProjector` по рамке и размеру;
 * интерактивная карта routes-04b добавит события движения, не меняя оверлей).
 */
export function projectLine(
  line: readonly (readonly [number, number])[],
  project: (lonLat: [lon: number, lat: number]) => Planar,
): Planar[] {
  return line.map(([lon, lat]) => project([lon, lat]));
}
