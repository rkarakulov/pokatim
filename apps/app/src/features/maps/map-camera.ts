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
