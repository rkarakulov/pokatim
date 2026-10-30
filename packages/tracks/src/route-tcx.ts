import { haversineMeters, type TrackPoint } from './geo.ts';

/**
 * Условная скорость синтетического времени TCX, км/ч (`[ASSUMPTION]` routes-formats RC-1) — не оценка «В пути»
 * карточки (`ROUTE_PACE_KMH` `@pokatim/route-view` зависит от покрытия; экспорт от него не зависит).
 */
export const ROUTE_TCX_PACE_KMH = 24;
/** Начало синтетического времени TCX: реального времени исходника в файле нет. */
export const ROUTE_TCX_START = '2000-01-01T00:00:00Z';
/** Имя курса TCX (`Name` обязателен схемой, ≤ 15 символов): названия маршрута в файле нет — как в GPX. */
const ROUTE_TCX_NAME = 'Pokatim';

const START_MS = Date.parse(ROUTE_TCX_START);
const PACE_MPS = ROUTE_TCX_PACE_KMH / 3.6;

const time = (seconds: number) =>
  new Date(START_MS + seconds * 1000).toISOString().replace('.000Z', 'Z');
const position = (point: TrackPoint) =>
  `<LatitudeDegrees>${point.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${point.lon.toFixed(6)}</LongitudeDegrees>`;
const hasEle = (point: TrackPoint): point is TrackPoint & { ele: number } =>
  point.ele !== undefined && Number.isFinite(point.ele);

/**
 * TCX v2 маршрута для скачивания (routes-formats): `Courses/Course` — `Name` = `Pokatim`, один `Lap` (итоги: время,
 * дистанция, начало и конец), `Track/Trackpoint` (`Time`, `Position`, `AltitudeMeters`?, накопленная
 * `DistanceMeters`) — порядок элементов по XSD (RC-11). `Time` обязателен схемой — синтетический: от
 * `ROUTE_TCX_START` при `ROUTE_TCX_PACE_KMH`, целые секунды, строго растёт. Дистанция — гаверсинус по точкам экспорта.
 * Только числа: строк исходника и названия маршрута в файле нет.
 */
export function routeTcx(points: readonly TrackPoint[]): string {
  const trackpoints: string[] = [];
  let distance = 0;
  let seconds = 0;
  points.forEach((point, i) => {
    if (i > 0) {
      distance += haversineMeters(points[i - 1]!, point);
      seconds = Math.max(seconds + 1, Math.round(distance / PACE_MPS));
    }
    const altitude = hasEle(point)
      ? `<AltitudeMeters>${point.ele.toFixed(1)}</AltitudeMeters>`
      : '';
    trackpoints.push(
      `<Trackpoint><Time>${time(seconds)}</Time><Position>${position(point)}</Position>${altitude}<DistanceMeters>${distance.toFixed(1)}</DistanceMeters></Trackpoint>\n`,
    );
  });
  const first = points[0];
  const last = points.at(-1);
  const lap =
    first && last
      ? `<Lap><TotalTimeSeconds>${seconds}</TotalTimeSeconds><DistanceMeters>${distance.toFixed(1)}</DistanceMeters>` +
        `<BeginPosition>${position(first)}</BeginPosition>` +
        (hasEle(first)
          ? `<BeginAltitudeMeters>${first.ele.toFixed(1)}</BeginAltitudeMeters>`
          : '') +
        `<EndPosition>${position(last)}</EndPosition>` +
        (hasEle(last) ? `<EndAltitudeMeters>${last.ele.toFixed(1)}</EndAltitudeMeters>` : '') +
        '<Intensity>Active</Intensity></Lap>\n'
      : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n',
    `<Courses><Course><Name>${ROUTE_TCX_NAME}</Name>\n`,
    lap,
    '<Track>\n',
    ...trackpoints,
    '</Track></Course></Courses>\n</TrainingCenterDatabase>\n',
  ].join('');
}
