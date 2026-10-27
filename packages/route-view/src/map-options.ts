import type { MapOptions, PaddingOptions } from 'maplibre-gl';

import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './camera.ts';
import { mapLocale } from './map-locale.ts';

/*
 * Жесты интерактивной web-карты (`maplibre-gl` 6) — общие для приложения (routes-04b/04c) и панели (routes-05, A2):
 * мышь и один палец двигают карту, колесо — зум только с Ctrl/⌘ (`guardWheelZoom`), вращение и наклон выключены.
 */

/**
 * Опции `new Map(...)` без контейнера и стиля: без кооперативного режима (`cooperativeGestures` maplibre-gl 6
 * связывает колесо с тачем — один палец тоже отдаётся странице, RC-2), зум `MAP_MIN_ZOOM…MAP_MAX_ZOOM`, начальная
 * камера — по рамке без анимации. Атрибуция — компактная; другое место контрола — вызывающий переопределяет
 * `attributionControl`. Вращение жестом щипка и клавиатурой выключают после создания:
 * `touchZoomRotate.disableRotation()`, `keyboard.disableRotation()`.
 */
export function interactiveMapOptions({
  bounds,
  padding,
}: {
  bounds: readonly [west: number, south: number, east: number, north: number];
  padding: number | PaddingOptions;
}): Omit<MapOptions, 'container' | 'style'> {
  return {
    interactive: true,
    cooperativeGestures: false,
    dragPan: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    locale: mapLocale(),
    attributionControl: { compact: true },
    bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
    fitBoundsOptions: { padding, animate: false },
  };
}

/** Сколько видна подсказка «колесо с Ctrl/⌘» после последнего прокручивания колесом над картой, мс. */
export const WHEEL_HINT_MS = 1500;

/**
 * Колесо мыши над web-картой (routes-04c): зум — только с Ctrl/⌘ (и щипок тачпада — браузер шлёт его колесом с
 * `ctrlKey`), без модификатора — прокрутка страницы. `cooperativeGestures` maplibre-gl 6 связывает колесо с тачем
 * (один палец тоже отдаётся странице), поэтому он выключен, а колесо без модификатора гасится здесь: слушатель в фазе
 * перехвата на контейнере карты останавливает событие до `scrollZoom` (он слушает внутренний узел холста) и не
 * отменяет его — страница прокручивается; `onBlocked` — показать подсказку. С модификатором событие идёт дальше —
 * зум `scrollZoom` вокруг курсора. Возвращает функцию снятия слушателя.
 */
export function guardWheelZoom(container: HTMLElement, onBlocked: () => void): () => void {
  const listener = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    onBlocked();
  };
  container.addEventListener('wheel', listener, { capture: true, passive: true });
  return () => container.removeEventListener('wheel', listener, { capture: true });
}

/** Подсказка — с ⌘ на Mac, с Ctrl на остальных (оба модификатора работают везде). */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
}
