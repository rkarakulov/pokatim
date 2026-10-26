// Вход для worker API (`@pokatim/tracks/parse`): разбор FIT/GPX (@garmin/fitsdk, fast-xml-parser) и потока
// агрегатора (node:zlib). Грузится Node напрямую (type stripping, `--conditions=@pokatim/source`) — только
// стираемый синтаксис TS.
import { gzipSync, gunzipSync } from 'node:zlib';

import { detectTrackFormat } from './format.ts';
import { parseFit } from './fit.ts';
import { haversineMeters, trackLengthMeters } from './geo.ts';
import { parseGpx } from './gpx.ts';
import { matchCorridor } from './corridor/match.ts';
import { prepareCorridor } from './corridor/prepare.ts';
import type { CorridorMatch, MatchWindow } from './corridor/types.ts';
import { checkPlausibility } from './plausibility.ts';
import { sanitizePoints } from './points.ts';
import { simplifyTrack } from './simplify.ts';
import { parseStream, type TrackStreamV1 } from './stream.ts';
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
export { parseStream, TrackStreamV1 } from './stream.ts';
export { matchCorridor } from './corridor/match.ts';
export { CORRIDOR_ENGINE_VERSION, CORRIDOR_POLICY } from './corridor/policy.ts';
export { prepareCorridor } from './corridor/prepare.ts';
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

/** Итог разбора маршрута для worker: только сериализуемые значения (structured clone). Координаты — [lon, lat]. */
export interface RouteAnalysis {
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
 * Маршрут GPX (`trk` или, без `trkpt`, `rte`) одним вызовом для worker: сигнатура → разбор → лимит точек → очистка
 * → длина → линии показа и сверки. Время в точках не нужно. Отказ — `TrackParseError` с `RouteFailureCode`.
 */
export function analyzeRoute(bytes: Uint8Array): RouteAnalysis {
  if (detectTrackFormat(bytes) !== 'gpx') throw new TrackParseError('unreadable');
  // предел точек маршрута — подсчётом до разбора XML (память потока worker)
  const track = parseGpx(new TextDecoder('utf-8').decode(bytes), {
    allowRoute: true,
    maxPoints: ROUTE_MAX_POINTS,
  });
  const points = sanitizePoints(track.points);
  if (points.length < 2) throw new TrackParseError('no_track');
  const lengthM = trackLengthMeters(points);
  if (lengthM < ROUTE_MIN_LENGTH_M) throw new TrackParseError('too_short');
  if (lengthM > ROUTE_MAX_LENGTH_M) throw new TrackParseError('too_long');
  const start = points[0]!;
  const finish = points[points.length - 1]!;

  return {
    distanceM: Math.round(lengthM),
    elevationGainM: elevationGainM(points),
    isLoop: haversineMeters(start, finish) <= LOOP_MAX_GAP_M,
    start: lonLat(start),
    finish: lonLat(finish),
    line: simplifyTrack(points, LINE_TOLERANCE_M, LINE_MAX_POINTS).map(lonLat),
    matchLine: simplifyTrack(points, MATCH_LINE_TOLERANCE_M, MATCH_LINE_MAX_POINTS).map(lonLat),
    sourcePointCount: track.points.length,
  };
}

/**
 * Сверка попытки для worker (слайс 03 — в потоке разбора): `loadTrack` → `matchCorridor` по исходнику без
 * прореживания. Ошибки файла — `TrackParseError` (как `analyzeTrack`); нарушение инвариантов коридора — `Error`
 * (ошибка программиста). Результат сериализуем (structured clone), без координат заезда и значений датчиков.
 */
export function analyzeAttempt(
  bytes: Uint8Array,
  format: TrackFormat,
  corridor: CorridorGeometry,
  window: MatchWindow,
  now: Date,
): CorridorMatch {
  const prepared = prepareCorridor(corridor);
  const { points } = loadTrack(bytes, format, now);
  return matchCorridor(points, prepared, window);
}
