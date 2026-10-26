/** Сторона `viewBox` превью: координаты нормируются в квадрат этого размера (единицы SVG, не px). */
const VIEW_SIZE = 1000;

/**
 * Проекция линии [lon, lat] в координаты SVG: равнопромежуточная вокруг центра (долгота × cos широты центра), ось Y
 * вниз, пропорции сохраняются — длинная сторона = `VIEW_SIZE`. Меньше двух различных точек — `null`.
 */
export function projectLine(
  points: readonly (readonly [number, number])[],
): { width: number; height: number; path: string } | null {
  if (points.length < 2) return null;
  const lats = points.map(([, lat]) => lat);
  const centerLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
  const kx = Math.cos(centerLat);
  const xs = points.map(([lon]) => lon * kx);
  const ys = points.map(([, lat]) => -lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const span = Math.max(spanX, spanY);
  if (span === 0) return null;
  const scale = VIEW_SIZE / span;
  const round = (value: number) => Math.round(value * 10) / 10;
  const path = xs.map((x, i) => `${round((x - minX) * scale)},${round((ys[i]! - minY) * scale)}`);
  return {
    width: Math.max(round(spanX * scale), 1),
    height: Math.max(round(spanY * scale), 1),
    path: path.join(' '),
  };
}

/**
 * Превью линии маршрута без подложки карты: SVG-полилиния, цвет — роль `map.route` темы, толщина — `stroke.indicator`
 * (CSS `.line-preview`). Декоративная картинка с текстовой альтернативой (`role="img"`), без интерактива.
 */
export function LinePreview({
  points,
  label,
}: {
  points: readonly (readonly [number, number])[];
  label: string;
}) {
  const projected = projectLine(points);
  return (
    <svg
      className="line-preview"
      role="img"
      aria-label={label}
      viewBox={projected ? `0 0 ${projected.width} ${projected.height}` : '0 0 1 1'}
      preserveAspectRatio="xMidYMid meet"
    >
      {projected ? <polyline className="line-preview__line" points={projected.path} /> : null}
    </svg>
  );
}
