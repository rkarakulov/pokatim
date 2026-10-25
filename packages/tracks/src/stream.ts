import { z } from 'zod';

import {
  TRACK_STREAM_MAX_POINTS,
  TrackParseError,
  type ActivitySport,
  type ParsedPoint,
  type ParsedTrack,
} from './track.ts';

/**
 * Поток агрегатора `pokatim.stream.v1` (Open Wearables → pokatim). Точка — `[время unix ms, lat, lon, ele | null]`.
 * Координаты вне диапазона и немонотонное время схема пропускает — их чистит `sanitizePoints`.
 */
export const TrackStreamV1 = z.object({
  v: z.literal(1),
  provider: z.string().max(40),
  sport: z.string().max(60),
  hasHeartRate: z.boolean(),
  hasPower: z.boolean(),
  points: z
    .array(z.tuple([z.number().int(), z.number(), z.number(), z.number().nullable()]))
    .max(TRACK_STREAM_MAX_POINTS),
});
export type TrackStreamV1 = z.infer<typeof TrackStreamV1>;

const AGGREGATOR_OUTDOOR_CYCLING_TYPES = [
  'cycling',
  'road_cycling',
  'mountain_biking',
  'gravel_cycling',
  'cyclocross',
  'e_biking',
  'bmx',
  'track_cycling',
] as const;
const AGGREGATOR_INDOOR_CYCLING_TYPES = ['indoor_cycling', 'virtual_cycling', 'spinning'] as const;

/** Все велотипы тренировок Open Wearables (уличные и indoor) — фильтр импорта в API. */
export const AGGREGATOR_CYCLING_TYPES: readonly string[] = [
  ...AGGREGATOR_OUTDOOR_CYCLING_TYPES,
  ...AGGREGATOR_INDOOR_CYCLING_TYPES,
];

/** Тип тренировки Open Wearables → спорт: велотипы — `cycling`/`cycling_indoor`, прочее — `other`, пусто — `unknown`. */
export function aggregatorSport(type: string): ActivitySport {
  const normalized = type.trim().toLowerCase();
  if (normalized === '') return 'unknown';
  if ((AGGREGATOR_OUTDOOR_CYCLING_TYPES as readonly string[]).includes(normalized))
    return 'cycling';
  if ((AGGREGATOR_INDOOR_CYCLING_TYPES as readonly string[]).includes(normalized)) {
    return 'cycling_indoor';
  }
  return 'other';
}

/**
 * Разбор потока (уже распакованного JSON). Больше `TRACK_STREAM_MAX_POINTS` точек — `too_many_points`
 * (проверка до схемы), не по схеме — `unreadable`.
 */
export function parseStream(json: unknown): ParsedTrack {
  if (
    typeof json === 'object' &&
    json !== null &&
    'points' in json &&
    Array.isArray(json.points) &&
    json.points.length > TRACK_STREAM_MAX_POINTS
  ) {
    throw new TrackParseError('too_many_points');
  }
  const parsed = TrackStreamV1.safeParse(json);
  if (!parsed.success) throw new TrackParseError('unreadable');
  const stream = parsed.data;

  const points = stream.points.map(([timeMs, lat, lon, ele]): ParsedPoint => {
    const point: ParsedPoint = { lat, lon, time: new Date(timeMs) };
    if (ele !== null) point.ele = ele;
    return point;
  });
  return {
    format: 'stream',
    sport: aggregatorSport(stream.sport),
    points,
    hasHeartRate: stream.hasHeartRate,
    hasPower: stream.hasPower,
  };
}
