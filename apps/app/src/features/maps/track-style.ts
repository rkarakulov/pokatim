import type { LineLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { LonLat, MyAttemptTrack, RaceRouteMap } from '@pokatim/contracts';
import { stroke, type AppTheme } from '@pokatim/design-tokens';
import { boundsOf } from '@pokatim/tracks';
import type { FeatureCollection, LineString } from 'geojson';

/*
 * Свой трек участника поверх маршрута и коридора (maps-02) — один источник для native и web: разрез линии трека
 * по дробным позициям разметки (посчитана worker при сверке), GeoJSON и слои MapLibre из ролей `map.track`,
 * `map.offCorridor`. Слои трека — под старт/финиш маршрута (`beforeId: 'start'`).
 */

/** Трек на карте: линия своей активности и разметка (позиции — дробные индексы вершин `i + t`). */
export type RouteMapTrack = Pick<MyAttemptTrack, 'line' | 'segment' | 'offRuns'>;

/** id источника GeoJSON трека на карте. */
export const TRACK_SOURCE_ID = 'my-track';
/** id слоя маршрута, под который кладутся слои трека (старт и финиш — поверх трека). */
export const TRACK_BEFORE_LAYER_ID = 'start';

/**
 * Части трека до старта и после финиша — прозрачнее сегмента: токена прозрачности в дизайн-системе нет (как
 * `CORRIDOR_OPACITY`, follow-up — токены карты в app-foundation).
 */
export const TRACK_OUTSIDE_OPACITY = 0.5;
/** Толщины, px: вне сегмента — тоньше осевой маршрута, сегмент — толще осевой, сход — толще сегмента. */
const OUTSIDE_WIDTH = stroke.input;
const SEGMENT_WIDTH = stroke.indicator + stroke.hairline;
const OFF_WIDTH = stroke.bannerError;
/** Пунктир схода, в толщинах линии: различим без цвета. */
const OFF_DASH = [1.5, 1];

type Run = MyAttemptTrack['segment'];
type TrackKind = 'outside' | 'segment' | 'off';

/** Точка линии в дробной позиции `i + t`. */
function pointAt(line: readonly LonLat[], position: number): LonLat {
  const i = Math.floor(position);
  const a = line[i]!;
  const b = line[i + 1];
  const t = position - i;
  if (b === undefined || t === 0) return a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Участок линии между позициями (зажаты в `[0, n − 1]`); пустой — `null`. */
function slice(line: readonly LonLat[], from: number, to: number): LonLat[] | null {
  const last = line.length - 1;
  const a = Math.max(0, Math.min(last, from));
  const b = Math.max(0, Math.min(last, to));
  if (!(b > a)) return null;
  const result: LonLat[] = [pointAt(line, a)];
  for (let i = Math.floor(a) + 1; i < b; i += 1) result.push(line[i]!);
  result.push(pointAt(line, b));
  return result;
}

/**
 * Разрез линии трека: «вне сегмента» (до выхода из ворот старта, после входа в ворота финиша), «сегмент», «сход».
 * Без разметки (`segment: null` — проверка идёт или разметки нет) — вся линия сегментом, без схода.
 */
export function splitTrackLine(
  line: readonly LonLat[],
  segment: Run,
  offRuns: readonly NonNullable<Run>[],
): Record<TrackKind, LonLat[][]> {
  const whole = slice(line, 0, line.length - 1);
  if (segment === null) return { outside: [], segment: whole ? [whole] : [], off: [] };
  const present = (part: LonLat[] | null): part is LonLat[] => part !== null;
  return {
    outside: [slice(line, 0, segment.from), slice(line, segment.to, line.length - 1)].filter(
      present,
    ),
    segment: [slice(line, segment.from, segment.to)].filter(present),
    off: offRuns.map((run) => slice(line, run.from, run.to)).filter(present),
  };
}

/** GeoJSON трека: линии с `properties.kind`. */
export function trackFeatures(
  track: RouteMapTrack,
): FeatureCollection<LineString, { kind: TrackKind }> {
  const parts = splitTrackLine(track.line, track.segment, track.offRuns);
  const kinds: TrackKind[] = ['outside', 'segment', 'off'];
  return {
    type: 'FeatureCollection',
    features: kinds.flatMap((kind) =>
      parts[kind].map((coordinates) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates },
        properties: { kind },
      })),
    ),
  };
}

/** Слои трека снизу вверх: вне сегмента, сегмент, сход (пунктир, толще). */
export function trackLayers(theme: AppTheme): LineLayerSpecification[] {
  const layer = (
    id: string,
    kind: TrackKind,
    paint: LineLayerSpecification['paint'],
    cap: 'round' | 'butt' = 'round',
  ): LineLayerSpecification => ({
    id,
    type: 'line',
    source: TRACK_SOURCE_ID,
    filter: ['==', ['get', 'kind'], kind],
    layout: { 'line-cap': cap, 'line-join': 'round' },
    paint,
  });
  return [
    layer('track-outside', 'outside', {
      'line-color': theme.map.track,
      'line-opacity': TRACK_OUTSIDE_OPACITY,
      'line-width': OUTSIDE_WIDTH,
    }),
    layer('track', 'segment', { 'line-color': theme.map.track, 'line-width': SEGMENT_WIDTH }),
    layer(
      'track-off',
      'off',
      {
        'line-color': theme.map.offCorridor,
        'line-width': OFF_WIDTH,
        'line-dasharray': OFF_DASH,
      },
      // пунктир со скруглёнными концами сливается в сплошную
      'butt',
    ),
  ];
}

/** Рамка камеры: маршрут и трек (если есть). */
export function unionBounds(
  route: RaceRouteMap['bounds'],
  line: readonly LonLat[] | undefined,
): RaceRouteMap['bounds'] {
  const track = line ? boundsOf(line) : null;
  if (!track) return route;
  return [
    Math.min(route[0], track[0]),
    Math.min(route[1], track[1]),
    Math.max(route[2], track[2]),
    Math.max(route[3], track[3]),
  ];
}
