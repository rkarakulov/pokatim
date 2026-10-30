import type { TrackPoint } from './geo.ts';

const hasEle = (point: TrackPoint) => point.ele !== undefined && Number.isFinite(point.ele);

/**
 * KML 2.2 маршрута для скачивания (routes-formats): один `Placemark/LineString/coordinates`, кортежи `lon,lat[,ele]`
 * (6 и 1 знак, высота — если конечна). Ни имени, ни стилей, ни метаданных исходника — только числа (как `routeGpx`).
 * Режим высоты: у **всех** точек есть высота — `altitudeMode` `absolute` (высоты — над уровнем моря, Google Earth не
 * прижимает линию к рельефу); хотя бы у одной нет — режим по умолчанию `clampToGround` (элемента нет): `absolute`
 * поставил бы точки без высоты на 0 м. Высоты в кортежах остаются в обоих случаях (профиль у приложений-читателей).
 */
export function routeKml(points: readonly TrackPoint[]): string {
  const absolute = points.length > 0 && points.every(hasEle);
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<kml xmlns="http://www.opengis.net/kml/2.2">\n',
    `<Document><Placemark><LineString>${absolute ? '<altitudeMode>absolute</altitudeMode>' : ''}<coordinates>\n`,
  ];
  for (const point of points) {
    const elevation = hasEle(point) ? `,${point.ele!.toFixed(1)}` : '';
    parts.push(`${point.lon.toFixed(6)},${point.lat.toFixed(6)}${elevation}\n`);
  }
  parts.push('</coordinates></LineString></Placemark></Document>\n</kml>\n');
  return parts.join('');
}
