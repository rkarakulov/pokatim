// Вход для worker API (`@pokatim/tracks/parse`): разбор FIT/GPX/KML/TCX (@garmin/fitsdk, fast-xml-parser), KMZ и
// потока агрегатора (node:zlib). Грузится Node напрямую (type stripping, `--conditions=@pokatim/source`) — только
// стираемый синтаксис TS.
import { gzipSync, gunzipSync } from 'node:zlib';

import { detectRouteFormat, detectTrackFormat } from './format.ts';
import { parseFit } from './fit.ts';
import { haversineMeters, trackLengthMeters } from './geo.ts';
import { parseGpx } from './gpx.ts';
import { parseKml } from './kml.ts';
import { kmlFromKmz } from './kmz.ts';
import { matchCorridor, matchCorridorDetailed } from './corridor/match.ts';
import { prepareCorridor } from './corridor/prepare.ts';
import { ROUTE_SECTIONS_VERSION, routeSections, sectionLine } from './corridor/sections.ts';
import { trackMapOf, type TrackMap } from './corridor/track-map.ts';
import type { CorridorMatch, MatchWindow } from './corridor/types.ts';
import { checkPlausibility } from './plausibility.ts';
import { sanitizePoints } from './points.ts';
import { simplifyTrack } from './simplify.ts';
import { buildSeries, type DisputeSeries, type SeriesWindow } from './series.ts';
import {
  FLAGS_VERSION,
  sensorFlags,
  type AttemptSensors,
  type SensorFlag,
} from './sensor-flags.ts';
import { routeGpx } from './route-gpx.ts';
import { routeKml } from './route-kml.ts';
import { routeTcx } from './route-tcx.ts';
import { elevationProfile } from './route-profile.ts';
import { parseStream, type TrackStreamV1 } from './stream.ts';
import { parseTcx } from './tcx.ts';
import { ROUTE_XML_MAX_ELEMENTS } from './xml.ts';
import { elevationGainM, summarizeTrack } from './summary.ts';
import {
  ROUTE_MAX_LENGTH_M,
  ROUTE_MAX_POINTS,
  ROUTE_MIN_LENGTH_M,
  TRACK_MAX_POINTS,
  TRACK_STREAM_MAX_POINTS,
  TrackParseError,
  type ActivitySport,
  type CorridorGeometry,
  type ParsedPoint,
  type ParsedTrack,
  type TrackFormat,
} from './track.ts';

export { parseFit } from './fit.ts';
export { parseGpx } from './gpx.ts';
export { parseKml } from './kml.ts';
export { kmlFromKmz, ROUTE_KMZ_MAX_KML_BYTES } from './kmz.ts';
export { ROUTE_XML_MAX_ELEMENTS } from './xml.ts';
export { parseTcx } from './tcx.ts';
export { parseStream, TrackStreamV1 } from './stream.ts';
export {
  matchCorridor,
  matchCorridorDetailed,
  type CorridorMatchDetailed,
  type OffRunMs,
} from './corridor/match.ts';
export { TRACK_MAP_MAX_RUNS, trackMapOf, type TrackMap } from './corridor/track-map.ts';
export {
  buildSeries,
  type DisputeSeries,
  SERIES_MAX_BINS,
  type SeriesSummary,
  type SeriesWindow,
} from './series.ts';
export {
  FLAGS_VERSION,
  SENSOR_FLAG_CODES,
  SENSOR_FLAGS_POLICY,
  SENSOR_SOURCES,
  sensorFlags,
  type AttemptSensors,
  type SensorFlag,
  type SensorFlagCode,
  type SensorPresence,
  type SensorSource,
} from './sensor-flags.ts';
export { CORRIDOR_ENGINE_VERSION, CORRIDOR_POLICY } from './corridor/policy.ts';
export { ROUTE_PROFILE_MAX_POINTS, elevationProfile } from './route-profile.ts';
export { routeGpx } from './route-gpx.ts';
export { routeKml } from './route-kml.ts';
export { ROUTE_TCX_PACE_KMH, ROUTE_TCX_START, routeTcx } from './route-tcx.ts';
export { CorridorError, prepareCorridor } from './corridor/prepare.ts';
export {
  ROUTE_SECTION_POLICY,
  ROUTE_SECTIONS_VERSION,
  routeSections,
  sectionLine,
  type RouteSection,
} from './corridor/sections.ts';
export {
  CORRIDOR_REJECTIONS,
  type CorridorMatch,
  type CorridorRejection,
  type CorridorSegment,
  type MatchWindow,
  type PreparedCorridor,
} from './corridor/types.ts';
export {
  ROUTE_MAX_POINTS,
  TRACK_MAX_POINTS,
  TRACK_STREAM_MAX_POINTS,
  TrackParseError,
  type ActivitySport,
  type CorridorGeometry,
  type ParsedPoint,
  type ParsedTrack,
  type RouteFailureCode,
  type TrackFailureCode,
  type TrackFormat,
} from './track.ts';

/** Предел распакованного потока, байт: больше — `unreadable` (gzip-бомба). 300 000 точек ≈ 15 МиБ JSON. */
export const TRACK_STREAM_MAX_JSON_BYTES = 64 * 1024 * 1024;

/** Допуск упрощения линии, м, и предел точек линии в `activity_tracks`. */
const LINE_TOLERANCE_M = 5;
const LINE_MAX_POINTS = 1000;
/** Линия сверки маршрута: допуск упрощения, м, и предел точек (сверка заезда — слайс 02). */
const MATCH_LINE_TOLERANCE_M = 1;
const MATCH_LINE_MAX_POINTS = 20_000;
/** Старт и финиш маршрута ближе — петля. */
const LOOP_MAX_GAP_M = 200;

/** Итог разбора для worker: только сериализуемые значения (structured clone), без значений пульса и мощности. */
export interface TrackAnalysis {
  format: TrackFormat;
  sport: ActivitySport;
  startedAt: Date;
  endedAt: Date;
  elapsedSec: number;
  movingSec: number;
  distanceM: number;
  elevationGainM: number | null;
  hasHeartRate: boolean;
  hasPower: boolean;
  /** [lon, lat] */
  startPoint: [number, number];
  /** [lon, lat], упрощённая: ≤ 1000 точек, ≥ 2 различных точек или `[]` */
  line: [number, number][];
  sourcePointCount: number;
}

/** Поток агрегатора → байты для хранилища: JSON, gzip. Вход не проверяется — его собирает адаптер API по типу. */
export function encodeTrackStream(stream: TrackStreamV1): Uint8Array {
  return gzipSync(JSON.stringify(stream));
}

/** Распаковка и разбор потока: битый gzip, превышение `TRACK_STREAM_MAX_JSON_BYTES`, не JSON — `unreadable`. */
export function decodeTrackStream(bytes: Uint8Array): ParsedTrack {
  let json: unknown;
  try {
    const text = gunzipSync(bytes, { maxOutputLength: TRACK_STREAM_MAX_JSON_BYTES }).toString(
      'utf8',
    );
    json = JSON.parse(text);
  } catch {
    throw new TrackParseError('unreadable');
  }
  return parseStream(json);
}

/** Файл FIT/GPX: формат по сигнатуре; не FIT и не GPX — `unreadable`. GPX — UTF-8 (BOM снимается). */
export function parseTrackFile(bytes: Uint8Array): ParsedTrack {
  const format = detectTrackFormat(bytes);
  if (format === 'fit') return parseFit(bytes);
  if (format === 'gpx') return parseGpx(new TextDecoder('utf-8').decode(bytes));
  throw new TrackParseError('unreadable');
}

/**
 * Общий шаг загрузки трека для worker: разбор → лимит точек → очистка → правдоподобие.
 * `format` — из документа загрузки; для FIT/GPX сверяется с сигнатурой (расхождение — `unreadable`).
 * Лимит точек: файл — `TRACK_MAX_POINTS`, поток — `TRACK_STREAM_MAX_POINTS`. Отказ — `TrackParseError` с кодом.
 */
export function loadTrack(
  bytes: Uint8Array,
  format: TrackFormat,
  now: Date,
): { track: ParsedTrack; points: ParsedPoint[] } {
  let track: ParsedTrack;
  if (format === 'stream') {
    track = decodeTrackStream(bytes);
  } else {
    if (detectTrackFormat(bytes) !== format) throw new TrackParseError('unreadable');
    track = parseTrackFile(bytes);
  }
  const maxPoints = format === 'stream' ? TRACK_STREAM_MAX_POINTS : TRACK_MAX_POINTS;
  if (track.points.length > maxPoints) throw new TrackParseError('too_many_points');
  const points = sanitizePoints(track.points);
  const failure = checkPlausibility(track, points, now);
  if (failure !== null) throw new TrackParseError(failure);
  return { track, points };
}

/** Всё для worker одним вызовом: `loadTrack` → итоги → линия. Отказ — `TrackParseError` с кодом. */
export function analyzeTrack(bytes: Uint8Array, format: TrackFormat, now: Date): TrackAnalysis {
  const { track, points } = loadTrack(bytes, format, now);
  const summary = summarizeTrack(points);
  const line = simplifyTrack(points, LINE_TOLERANCE_M, LINE_MAX_POINTS);
  const start = points[0]!;

  return {
    format: track.format,
    sport: track.sport,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    elapsedSec: summary.elapsedSec,
    movingSec: summary.movingSec,
    distanceM: summary.distanceM,
    elevationGainM: summary.elevationGainM,
    hasHeartRate: track.hasHeartRate,
    hasPower: track.hasPower,
    startPoint: [start.lon, start.lat],
    line: line.map((point): [number, number] => [point.lon, point.lat]),
    sourcePointCount: track.points.length,
  };
}

/**
 * Версия производных данных маршрута (профиль высоты и экспорт, routes-03). +1 при смене
 * `elevationProfile`/`routeGpx`/`routeKml`/`routeTcx`/допуска точек экспорта — регламент `routes-maintenance`
 * пересчитает готовые маршруты. 2 — экспорт KML и TCX (routes-formats).
 */
export const ROUTE_DERIVED_VERSION = 2;

/** Производные данные маршрута (routes-03): только сериализуемые значения (structured clone). */
export interface RouteDerived {
  /** профиль высоты `[distanceM, elevationM]` (целые, ≤ 300 точек); `null` — в маршруте нет высот */
  profile: [number, number][] | null;
  /** очищенный GPX 1.1: только точки линии сверки с высотами */
  gpx: string;
  /** KML 2.2 из тех же точек (routes-formats) */
  kml: string;
  /** TCX v2 (курс) из тех же точек, синтетическое время (routes-formats) */
  tcx: string;
}

/** Итог разбора маршрута для worker: только сериализуемые значения (structured clone). Координаты — [lon, lat]. */
export interface RouteAnalysis extends RouteDerived {
  /** м, целое */
  distanceM: number;
  /** м, целое; `null` — в маршруте нет высот */
  elevationGainM: number | null;
  isLoop: boolean;
  start: [number, number];
  finish: [number, number];
  /** линия показа: ≤ 1000 точек, концы сохранены */
  line: [number, number][];
  /** линия сверки: ≤ 20 000 точек, концы сохранены */
  matchLine: [number, number][];
  sourcePointCount: number;
}

const lonLat = (point: { lon: number; lat: number }): [number, number] => [point.lon, point.lat];

/**
 * Общий шаг разбора маршрута: сигнатура GPX, KML (`LineString`/`gx:Track`, routes-02), KMZ или TCX (routes-formats)
 * → разбор (GPX — `trk` или, без `trkpt`, `rte`; KMZ — KML из архива, `kmlFromKmz`, с той же проверкой сигнатуры
 * KML; TCX — `Trackpoint` всех `Track`) с пределом точек → очистка → ≥ 2 точек → пределы длины. Время в точках не
 * нужно. Отказ — `TrackParseError` с `RouteFailureCode`. Новые форматы маршрута добавляются сюда — их разбирают и
 * `analyzeRoute`, и бэкфилл `deriveRoute` (RC-12).
 */
function loadRoutePoints(bytes: Uint8Array): {
  points: ParsedPoint[];
  sourcePointCount: number;
  lengthM: number;
} {
  let format = detectRouteFormat(bytes);
  let source = bytes;
  if (format === 'kmz') {
    source = kmlFromKmz(bytes);
    // внутри — только KML (тот же сканер пролога: `<!DOCTYPE` до корня — отказ)
    format = detectRouteFormat(source) === 'kml' ? 'kml' : null;
  }
  if (format === null) throw new TrackParseError('unreadable');
  const text = new TextDecoder('utf-8').decode(source);
  // предел точек и элементов маршрута — подсчётом до разбора XML (память потока worker)
  const options = { maxPoints: ROUTE_MAX_POINTS };
  const track =
    format === 'gpx'
      ? parseGpx(text, { allowRoute: true, maxElements: ROUTE_XML_MAX_ELEMENTS, ...options })
      : format === 'tcx'
        ? parseTcx(text, options)
        : parseKml(text, options);
  const points = sanitizePoints(track.points);
  if (points.length < 2) throw new TrackParseError('no_track');
  const lengthM = trackLengthMeters(points);
  if (lengthM < ROUTE_MIN_LENGTH_M) throw new TrackParseError('too_short');
  if (lengthM > ROUTE_MAX_LENGTH_M) throw new TrackParseError('too_long');
  return { points, sourcePointCount: track.points.length, lengthM };
}

/** Точки линии сверки (одно вычисление — и `matchLine`, и точки экспорта GPX/KML/TCX). */
const matchPointsOf = (points: readonly ParsedPoint[]) =>
  simplifyTrack(points, MATCH_LINE_TOLERANCE_M, MATCH_LINE_MAX_POINTS);

/** Файлы экспорта из точек линии сверки — одни точки для всех форматов. */
const exportsOf = (matchPoints: readonly ParsedPoint[]) => ({
  gpx: routeGpx(matchPoints),
  kml: routeKml(matchPoints),
  tcx: routeTcx(matchPoints),
});

/**
 * Маршрут одним вызовом для worker: `loadRoutePoints` → длина → линии показа и сверки → профиль высоты и экспорт
 * (GPX, KML, TCX). Отказ — `TrackParseError` с `RouteFailureCode`.
 */
export function analyzeRoute(bytes: Uint8Array): RouteAnalysis {
  const { points, sourcePointCount, lengthM } = loadRoutePoints(bytes);
  const start = points[0]!;
  const finish = points[points.length - 1]!;
  const matchPoints = matchPointsOf(points);

  return {
    distanceM: Math.round(lengthM),
    elevationGainM: elevationGainM(points),
    isLoop: haversineMeters(start, finish) <= LOOP_MAX_GAP_M,
    start: lonLat(start),
    finish: lonLat(finish),
    line: simplifyTrack(points, LINE_TOLERANCE_M, LINE_MAX_POINTS).map(lonLat),
    matchLine: matchPoints.map(lonLat),
    sourcePointCount,
    profile: elevationProfile(points),
    ...exportsOf(matchPoints),
  };
}

/**
 * Производные данные готового маршрута для бэкфилла (регламент `routes-maintenance`, поток разбора worker): тот же
 * разбор исходника, что `analyzeRoute`, только `profile` и экспорт. Отказ — `TrackParseError` с тем же кодом.
 */
export function deriveRoute(bytes: Uint8Array): RouteDerived {
  const { points } = loadRoutePoints(bytes);
  return { profile: elevationProfile(points), ...exportsOf(matchPointsOf(points)) };
}

/**
 * Итог сверки попытки для worker: результат движка, разметка трека на линии показа (maps-02), датчики и флаги
 * сегмента (race-results-07; вне `CorridorMatch` — golden коридора и версия движка не меняются).
 */
export type AttemptAnalysis = CorridorMatch & {
  /** позиции сегмента и схода на линии `activity_tracks`; `null` — нет сегмента, нет линии или она не от этого файла */
  trackMap: TrackMap | null;
  /**
   * каналы в сегменте; `null` — сегмента нет. Поток агрегатора — заявленные признаки тренировки (`declared`) без
   * флагов: рядов датчиков в нём нет (ADR-0011)
   */
  sensors: AttemptSensors | null;
  /** флаги датчиков сегмента (целые проценты) */
  flags: SensorFlag[];
  flagsVersion: number;
};

/**
 * Сверка попытки для worker (слайс 03 — в потоке разбора): `loadTrack` → `matchCorridorDetailed` по исходнику без
 * прореживания → разметка схода на сохранённой линии показа `line` (`activity_tracks`, читает worker; не
 * пересчитывается — позиции по той же линии, что у активности). `line: null` (по умолчанию) — `trackMap: null`.
 * Ошибки файла — `TrackParseError` (как `analyzeTrack`); нарушение инвариантов коридора — `CorridorError`.
 * Результат сериализуем (structured clone), без координат заезда, времени точек и значений датчиков.
 */
export function analyzeAttempt(
  bytes: Uint8Array,
  format: TrackFormat,
  corridor: CorridorGeometry,
  window: MatchWindow,
  now: Date,
  line: [number, number][] | null = null,
): AttemptAnalysis {
  const prepared = prepareCorridor(corridor);
  const { track, points } = loadTrack(bytes, format, now);
  const { match, offRunsMs } = matchCorridorDetailed(points, prepared, window);
  let sensors: AttemptSensors | null = null;
  let flags: SensorFlag[] = [];
  if (match.segment && track.format === 'stream') {
    sensors = { hr: track.hasHeartRate, power: track.hasPower, source: 'declared' };
  } else if (match.segment) {
    const sampled = sensorFlags(points, match.segment);
    sensors = { ...sampled.sensors, source: 'samples' };
    flags = sampled.flags;
  }
  return {
    ...match,
    trackMap: trackMapOf(points, line, match.segment, offRunsMs),
    sensors,
    flags,
    flagsVersion: FLAGS_VERSION,
  };
}

/**
 * Ряды пульса, мощности и скорости сегмента попытки для разбора спора (слайс 06b) — в потоке разбора worker:
 * `loadTrack` → `buildSeries` по исходнику без прореживания. Значения датчиков выходят из потока только прореженными
 * (≤ `SERIES_MAX_BINS` ячеек), без координат и времени точек. Ошибки файла — `TrackParseError`.
 */
export function analyzeSeries(
  bytes: Uint8Array,
  format: TrackFormat,
  window: SeriesWindow,
  now: Date,
): DisputeSeries {
  const { points } = loadTrack(bytes, format, now);
  return buildSeries(points, window);
}

/** Итог сверки одного участка маршрута (route-rides-05). */
export interface RouteSectionResult {
  /** м по линии сверки от старта (целые) */
  fromM: number;
  toM: number;
  verdict: 'counted' | 'rejected';
  /** время участка, с — только у `counted` */
  elapsedSec: number | null;
}

/** Итог сверки участков: `ROUTE_SECTIONS_VERSION`, участки по порядку (`[]` — у маршрута участков нет). */
export interface RouteSectionsAnalysis {
  version: number;
  items: RouteSectionResult[];
}

/**
 * Сверка участков маршрута для worker (route-rides-05, U2) — отдельный вызов потока разбора после основной сверки:
 * `routeSections(corridor.line, corridor.widthM)` → участков нет — итог без разбора файла; иначе `loadTrack` один раз
 * → по участку неизменённые `prepareCorridor` (подлиния, `isLoop: false`) и `matchCorridor` (подготовленный коридор
 * участка не копится). Движок, его версия и golden не меняются — версия участков `ROUTE_SECTIONS_VERSION`. Ошибки
 * файла — `TrackParseError`; нарушение инвариантов коридора участка — `CorridorError` (весь набор отвергается).
 * Результат сериализуем, без координат и времени точек.
 */
export function analyzeSections(
  bytes: Uint8Array,
  format: TrackFormat,
  corridor: CorridorGeometry,
  window: MatchWindow,
  now: Date,
): RouteSectionsAnalysis {
  const sections = routeSections(corridor.line, corridor.widthM);
  if (sections.length === 0) return { version: ROUTE_SECTIONS_VERSION, items: [] };
  const { points } = loadTrack(bytes, format, now);
  const items = sections.map(({ fromM, toM }): RouteSectionResult => {
    const prepared = prepareCorridor({
      line: sectionLine(corridor.line, fromM, toM),
      widthM: corridor.widthM,
      isLoop: false,
      distanceM: toM - fromM,
    });
    const match = matchCorridor(points, prepared, window);
    const counted = match.verdict === 'counted';
    return {
      fromM,
      toM,
      verdict: match.verdict,
      elapsedSec: counted ? match.segment!.elapsedSec : null,
    };
  });
  return { version: ROUTE_SECTIONS_VERSION, items };
}
