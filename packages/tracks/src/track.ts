import type { TrackPoint } from './geo.ts';

/**
 * Значения совпадают с `TRACK_FORMATS` контракта (`@pokatim/contracts`); пакет от контракта не зависит.
 * `stream` — поток агрегатора `pokatim.stream.v1` (gzip JSON), по сигнатуре не определяется.
 */
export type TrackFormat = 'fit' | 'gpx' | 'stream';

/** Совпадает с `ACTIVITY_SPORTS` контракта. */
export type ActivitySport = 'cycling' | 'cycling_indoor' | 'other' | 'unknown';

/** Совпадает с `TRACK_FAILURE_CODES` контракта. `timeout` и `storage` ставит worker, не пакет. */
export type TrackFailureCode =
  | 'unreadable'
  | 'no_track'
  | 'no_timestamps'
  | 'implausible'
  | 'too_many_points'
  | 'timeout'
  | 'storage';

/** Совпадает с `ROUTE_FAILURE_CODES` контракта. `timeout` ставит worker, не пакет. */
export type RouteFailureCode =
  'unreadable' | 'no_track' | 'too_many_points' | 'too_short' | 'too_long' | 'timeout';

export const TRACK_FILE_MAX_BYTES = 16 * 1024 * 1024;
export const TRACK_FILE_EXTENSIONS = ['fit', 'gpx'] as const;
/** Больше точек в файле FIT/GPX — `too_many_points` (≈ 55 ч записи раз в секунду). */
export const TRACK_MAX_POINTS = 200_000;
/** Больше точек в потоке агрегатора — `too_many_points`. */
export const TRACK_STREAM_MAX_POINTS = 300_000;

/** Больше точек в GPX маршрута — `too_many_points`. */
export const ROUTE_MAX_POINTS = 50_000;
/** Пределы длины маршрута, м: короче — `too_short`, длиннее — `too_long`. */
export const ROUTE_MIN_LENGTH_M = 1000;
export const ROUTE_MAX_LENGTH_M = 1_000_000;

/**
 * Эталонный коридор гонки для сверки заезда (вход `matchCorridor`, слайс 02): линия сверки маршрута [lon, lat],
 * допуск ±`widthM` от линии, петля и длина маршрута. Ворота — вокруг первой и последней точки линии; `isLoop` —
 * только развёртка пройденной доли по кругам; `distanceM` — диагностика (метрика коридора — длина линии).
 */
export interface CorridorGeometry {
  line: [number, number][];
  widthM: number;
  isLoop: boolean;
  distanceM: number;
}

/** Точка разбора. Значения датчиков — только внутри процесса разбора, наружу выходят флаги. */
export interface ParsedPoint extends TrackPoint {
  hr?: number;
  power?: number;
  cadence?: number;
}

export interface ParsedTrack {
  format: TrackFormat;
  sport: ActivitySport;
  /** Только точки с координатами-числами; записи без позиции (indoor, потеря GPS) парсер пропускает. */
  points: ParsedPoint[];
  sessionStartedAt?: Date;
  sessionElapsedSec?: number;
  hasHeartRate: boolean;
  hasPower: boolean;
}

export interface TrackSummary {
  startedAt: Date;
  endedAt: Date;
  /** целые секунды */
  elapsedSec: number;
  movingSec: number;
  /** м, целое */
  distanceM: number;
  /** м, целое; `null` — в треке нет высот */
  elevationGainM: number | null;
}

export class TrackParseError extends Error {
  readonly code: TrackFailureCode | RouteFailureCode;

  constructor(code: TrackFailureCode | RouteFailureCode) {
    super(`track: ${code}`);
    this.name = 'TrackParseError';
    this.code = code;
  }
}
