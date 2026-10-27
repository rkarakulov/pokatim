import type { Planar } from '@pokatim/tracks';

/*
 * Камера интерактивной карты (routes-04b, ADR-0014): ограничения зума и чистая математика жестов двумя пальцами
 * (native — RNGH поверх карты, RC-2). Без RN и RNGH — идёт и в web-бандл (константы).
 */

/** Минимальный зум (RC-8): ≈ 1100 км по ширине телефона — вся Беларусь с запасом, рамка маршрута не обрезается. */
export const MAP_MIN_ZOOM = 4;
/** Максимальный зум (RC-8): уровень улиц; выше тайлов OpenFreeMap (14) — overzoom. */
export const MAP_MAX_ZOOM = 17;
/** Шаг кнопок «+», «−» и двойного тапа. */
export const MAP_ZOOM_STEP = 1;
/**
 * Длительность анимации камеры кнопок и двойного тапа, мс (RC-9); при reduce motion — без анимации. Токена
 * длительности в `motion` нет — follow-up в app-foundation.
 */
export const MAP_CAMERA_ANIMATION_MS = 300;

export interface MapCamera {
  center: [lon: number, lat: number];
  zoom: number;
}

export interface MapViewSize {
  width: number;
  height: number;
}

/** Размер тайла MapLibre, px: ширина мира при zoom 0. */
const TILE_SIZE = 512;
/** Предел широты Web Mercator. */
const MAX_LATITUDE = 85.051129;

export function clampZoom(zoom: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, zoom));
}

/** `[lon, lat]` → доли мира Web Mercator `[0…1, 0…1]` (y — вниз). */
function toUnit([lon, lat]: readonly [number, number]): Planar {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const rad = (clamped * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2];
}

function fromUnit([x, y]: Planar): [lon: number, lat: number] {
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [x * 360 - 180, Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))];
}

/**
 * Камера после жеста двумя пальцами: точка карты под `focal0` при камере `start` оказывается под `focal`; зум —
 * `start.zoom + log2(scale)` в пределах `MAP_MIN_ZOOM…MAP_MAX_ZOOM`. Пиксели — от левого верхнего угла вида.
 */
export function cameraAfterGesture(
  start: MapCamera,
  view: MapViewSize,
  gesture: { focal0: Planar; focal: Planar; scale: number },
): MapCamera {
  const zoom = clampZoom(start.zoom + Math.log2(gesture.scale));
  const world0 = TILE_SIZE * 2 ** start.zoom;
  const world1 = TILE_SIZE * 2 ** zoom;
  const [cx, cy] = toUnit(start.center);
  // точка под пальцами в долях мира
  const ux = cx + (gesture.focal0[0] - view.width / 2) / world0;
  const uy = cy + (gesture.focal0[1] - view.height / 2) / world0;
  return {
    center: fromUnit([
      ux - (gesture.focal[0] - view.width / 2) / world1,
      uy - (gesture.focal[1] - view.height / 2) / world1,
    ]),
    zoom,
  };
}

/** Зум на `delta` вокруг точки вида (двойной тап): точка остаётся под пальцем. */
export function zoomAround(
  start: MapCamera,
  view: MapViewSize,
  point: Planar,
  delta: number,
): MapCamera {
  return cameraAfterGesture(start, view, { focal0: point, focal: point, scale: 2 ** delta });
}
