import type { ParsedPoint, ParsedTrack, TrackFailureCode } from './track.ts';

const EARLIEST_START_MS = Date.UTC(2000, 0, 1);
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 48 * 60 * 60 * 1000;
/** Очистка отбросила больше половины точек — файлу не доверяем. */
const MIN_KEPT_RATIO = 0.5;

/**
 * Правдоподобие трека. Отклонение от сигнатуры spec (`checkPlausibility(track, now)`): нужна и исходная, и
 * очищенная выборка — доля отброшенных точек считается от исходных точек с координатами.
 * Порядок: `no_track` (< 2 исходных точек с координатами) → `no_timestamps` (< 2 точек со временем) →
 * `implausible` (очистка оставила < 50 %, начало раньше 2000-01-01 или позже `now + 24 ч`, длительность > 48 ч).
 */
export function checkPlausibility(
  raw: ParsedTrack,
  sanitized: readonly ParsedPoint[],
  now: Date,
): TrackFailureCode | null {
  const rawCount = raw.points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
  ).length;
  if (rawCount < 2) return 'no_track';
  if (raw.points.filter((point) => point.time !== undefined).length < 2) return 'no_timestamps';
  if (sanitized.length < 2 || sanitized.length < rawCount * MIN_KEPT_RATIO) return 'implausible';

  const timed = sanitized.filter((point) => point.time !== undefined);
  if (timed.length < 2) return 'no_timestamps';
  const start = timed[0]!.time!.getTime();
  const end = timed[timed.length - 1]!.time!.getTime();
  if (start < EARLIEST_START_MS || start > now.getTime() + FUTURE_SLACK_MS) return 'implausible';
  if (end - start > MAX_DURATION_MS) return 'implausible';
  return null;
}
