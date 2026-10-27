import type { TrackPoint } from './geo.ts';

/**
 * Очищенный GPX 1.1 маршрута для скачивания (routes-03): один `trk/trkseg`, только `trkpt lat lon` (6 знаков) и
 * `ele` (1 знак, если высота конечна). Ни `metadata`, ни `name`, ни `time`, ни `extensions` — строки исходника в
 * выход не попадают, только числа.
 */
export function routeGpx(points: readonly TrackPoint[]): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<gpx version="1.1" creator="Pokatim" xmlns="http://www.topografix.com/GPX/1/1">\n',
    '<trk><trkseg>\n',
  ];
  for (const { lat, lon, ele } of points) {
    const elevation =
      ele !== undefined && Number.isFinite(ele) ? `<ele>${ele.toFixed(1)}</ele>` : '';
    parts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${elevation}</trkpt>\n`);
  }
  parts.push('</trkseg></trk>\n</gpx>\n');
  return parts.join('');
}
