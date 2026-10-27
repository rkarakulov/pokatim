import { XMLParser } from 'fast-xml-parser';

import {
  TRACK_MAX_POINTS,
  TrackParseError,
  type ActivitySport,
  type ParsedPoint,
  type ParsedTrack,
} from './track.ts';
import {
  assertElementCount,
  assertNoForbiddenMarkup,
  countTags,
  parseValidXml,
  XML_MAX_ELEMENTS,
} from './xml.ts';

/** Прежнее имя предела элементов GPX — общий `XML_MAX_ELEMENTS` (`xml.ts`). */
export const GPX_MAX_ELEMENTS = XML_MAX_ELEMENTS;
export { countTags };

/**
 * `<trk><type>`: Garmin Connect/Komoot/RideWithGPS пишут строку (`cycling`, `road_biking`, …), старые экспорты
 * Strava — числовой код активности (`1` — Ride, `9` — Run). Неизвестное значение и отсутствие `<type>` — `unknown`.
 */
const CYCLING_TYPES = new Set([
  '1',
  'cycling',
  'biking',
  'bike',
  'ride',
  'road_biking',
  'road_cycling',
  'mountain_biking',
  'gravel_cycling',
  'cyclocross',
  'e_bike_ride',
  'ebikeride',
]);
const INDOOR_CYCLING_TYPES = new Set(['indoor_cycling', 'virtual_ride', 'virtualride']);
const OTHER_TYPES = new Set([
  '9',
  '10',
  'running',
  'run',
  'trail_running',
  'walking',
  'walk',
  'hiking',
  'hike',
  'swimming',
  'swim',
  'skiing',
  'cross_country_skiing',
  'other',
]);

const ALWAYS_ARRAY = new Set(['trk', 'trkseg', 'trkpt', 'rte', 'rtept']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  htmlEntities: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (tagName) => ALWAYS_ARRAY.has(tagName),
});

type XmlNode = Record<string, unknown>;

export interface ParseGpxOptions {
  /** Маршрут: без `trkpt` в документе берутся точки `rte/rtept` (планировщики). Заезды — без этого флага. */
  allowRoute?: boolean;
  /** Предел точек (`trkpt`, при `allowRoute` — и `rtept`) — подсчётом до разбора; по умолчанию `TRACK_MAX_POINTS`. */
  maxPoints?: number;
}

/**
 * Разбор GPX (`fast-xml-parser`, без DTD, сущностей и внешних ресурсов). Трек — только `trk/trkseg/trkpt`
 * (точки `wpt` не считаются; маршрут `rte` — только при `allowRoute` и только если в документе нет ни одной
 * `trkpt`). Пульс, каденс и мощность — из расширений (Garmin `TrackPointExtension` `hr`/`cad`, `power` — в
 * `extensions` точки), только для флагов.
 */
export function parseGpx(text: string, options: ParseGpxOptions = {}): ParsedTrack {
  assertNoForbiddenMarkup(text);
  // размер — до разбора в дерево (память потока worker)
  const maxPoints = options.maxPoints ?? TRACK_MAX_POINTS;
  assertElementCount(text);
  if (
    countTags(text, 'trkpt') > maxPoints ||
    (options.allowRoute === true && countTags(text, 'rtept') > maxPoints)
  ) {
    throw new TrackParseError('too_many_points');
  }
  const document = parseValidXml(text, parser);
  const gpx = isNode(document) ? document['gpx'] : undefined;
  if (!isNode(gpx)) throw new TrackParseError('unreadable');

  const tracks = asNodes(gpx['trk']);
  let nodes = tracks.flatMap((track) =>
    asNodes(track['trkseg']).flatMap((segment) => asNodes(segment['trkpt'])),
  );
  if (nodes.length === 0 && options.allowRoute === true) {
    nodes = asNodes(gpx['rte']).flatMap((route) => asNodes(route['rtept']));
  }
  const points: ParsedPoint[] = [];
  let hasHeartRate = false;
  let hasPower = false;
  for (const node of nodes) {
    const point = gpxPoint(node);
    if (point === null) continue;
    if (point.hr !== undefined) hasHeartRate = true;
    if (point.power !== undefined) hasPower = true;
    points.push(point);
  }

  return { format: 'gpx', sport: gpxSport(tracks), points, hasHeartRate, hasPower };
}

function gpxPoint(node: XmlNode): ParsedPoint | null {
  const lat = toNumber(node['@_lat']);
  const lon = toNumber(node['@_lon']);
  if (lat === undefined || lon === undefined) return null;
  const point: ParsedPoint = { lat, lon };
  const ele = toNumber(node['ele']);
  if (ele !== undefined) point.ele = ele;
  const timeText = text(node['time']);
  if (timeText !== undefined) {
    const time = new Date(timeText);
    if (!Number.isNaN(time.getTime())) point.time = time;
  }
  const extensions = node['extensions'];
  if (isNode(extensions)) {
    const hr = positive(findValue(extensions, 'hr', 3));
    const cadence = positive(findValue(extensions, 'cad', 3));
    const power = nonNegative(findValue(extensions, 'power', 3));
    if (hr !== undefined) point.hr = hr;
    if (cadence !== undefined) point.cadence = cadence;
    if (power !== undefined) point.power = power;
  }
  return point;
}

function gpxSport(tracks: readonly XmlNode[]): ActivitySport {
  for (const track of tracks) {
    const type = text(track['type'])?.trim().toLowerCase();
    if (type === undefined || type === '') continue;
    if (CYCLING_TYPES.has(type)) return 'cycling';
    if (INDOOR_CYCLING_TYPES.has(type)) return 'cycling_indoor';
    if (OTHER_TYPES.has(type)) return 'other';
    return 'unknown';
  }
  return 'unknown';
}

/** Поиск поля расширения на небольшой глубине (`extensions/TrackPointExtension/hr`, `extensions/power`). */
function findValue(node: XmlNode, key: string, depth: number): unknown {
  if (key in node) return node[key];
  if (depth <= 0) return undefined;
  for (const value of Object.values(node)) {
    if (!isNode(value)) continue;
    const found = findValue(value, key, depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNodes(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value.filter(isNode);
  return isNode(value) ? [value] : [];
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isNode(value)) return text(value['#text']);
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  const raw = text(value)?.trim();
  if (raw === undefined || raw === '') return undefined;
  const number = Number(raw);
  return Number.isFinite(number) ? number : undefined;
}

function positive(value: unknown): number | undefined {
  const number = toNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

/** Мощность 0 (накат) — отсчёт, не пропуск (race-results-07: флаги датчиков). */
function nonNegative(value: unknown): number | undefined {
  const number = toNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}
