import { size } from '@pokatim/design-tokens';

import { MAP_FIT_PADDING } from './corridor-style';

/*
 * Камера интерактивной карты (routes-04b, ADR-0014): ограничения зума, шаг и длительность кнопок. Жесты — нативные
 * MapLibre RN / maplibre-gl (routes-04c: перетаскивание одним пальцем). Без RN и RNGH — идёт и в web-бандл.
 */

/**
 * Минимальный зум (RC-8, ревью pass 1 M1): рамка любого реального маршрута вписывается и на узком телефоне — зум 2 на
 * карте 3:2 шириной 320 px (≈ 130 px по вертикали после отступов) — ≈ 13° широты на 54° с. ш. (≈ 1400 км), а гонка
 * — до 1000 км, «Мои маршруты» — любой GPX. Минимум выше зума рамки обрезал бы начальную камеру и «в рамку».
 */
export const MAP_MIN_ZOOM = 2;
/** Максимальный зум (RC-8): уровень улиц; выше тайлов OpenFreeMap (14) — overzoom. */
export const MAP_MAX_ZOOM = 17;
/** Шаг кнопок «+», «−». */
export const MAP_ZOOM_STEP = 1;
/**
 * Длительность анимации камеры кнопок, мс (RC-9); при reduce motion — без анимации. Токена
 * длительности в `motion` нет — follow-up в app-foundation.
 */
export const MAP_CAMERA_ANIMATION_MS = 300;

export interface MapViewSize {
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, zoom));
}

/** Последний вид камеры из событий региона (`ViewState` MapLibre RN; в тестах — частичный). */
export interface MapViewSnapshot {
  center?: readonly [number, number];
  zoom?: number;
  bounds: readonly [west: number, south: number, east: number, north: number];
}

/**
 * Вызов камеры MapLibre RN: до инициализации нативного вида `setStop` бросает, нативный промис может отклониться —
 * нажатие кнопки не должно ронять экран.
 */
export function cameraCall(call: () => unknown): void {
  try {
    void Promise.resolve(call()).catch(() => undefined);
  } catch {
    // карта ещё не готова — вызов пропускается
  }
}

/** Отступы камеры, px (`ViewPadding` MapLibre RN; web — `PaddingOptions` maplibre-gl). */
export interface CameraPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Наименьшая высота поля камеры над шторкой, px: отступы не съедают холст целиком. */
export const CAMERA_MIN_VIEW_PX = size.touchMin * 2;

/**
 * Отступ камеры с учётом шторки (routes-04d, RC-5): `MAP_FIT_PADDING` + видимая высота шторки снизу. Ограничен
 * высотой карты — без ограничения `fitBounds` maplibre-gl при отступах больше холста предупреждает и не двигает
 * камеру; над шторкой остаётся не меньше `CAMERA_MIN_VIEW_PX`. Высота карты неизвестна — только база. Целые
 * пиксели (натив принимает Int32).
 */
export function cameraPadding(insetBottom: number, mapHeight: number | null): CameraPadding {
  const base = { ...MAP_FIT_PADDING };
  if (mapHeight === null || insetBottom <= 0) return base;
  const max = Math.max(base.bottom, mapHeight - base.top - CAMERA_MIN_VIEW_PX);
  return { ...base, bottom: Math.round(Math.min(base.bottom + insetBottom, max)) };
}
