import type { Planar } from '@pokatim/tracks';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** Кто ведёт позицию сейчас: палец/мышь на профиле, маркер на карте или никто (routes-04, RC-3). */
export type ScrubDragging = 'profile' | 'map' | null;

export interface ScrubState {
  /** позиция — доля 0…1 длины линии показа (= доля дистанции маршрута, S6) */
  fraction: number;
  /** курсор профиля и карточка видны */
  active: boolean;
  dragging: ScrubDragging;
}

export type ScrubStore = StoreApi<ScrubState>;

/**
 * Стор скраббинга на экземпляр экрана (routes-04, RC-5): профиль и маркер карты читают и пишут долю, перерисовываются
 * только подписчики (`useScrub` с селектором) — не карта и не экран. Не синглтон модуля (SSR — общий процесс):
 * экран создаёт свой (`useMemo(createScrubStore, [id])`, панель — `useState(createScrubStore)`); React-хук подписки — у
 * потребителя (`useStore` из `zustand`); начальное состояние детерминировано — SSR = первый рендер.
 */
export function createScrubStore(): ScrubStore {
  return createStore<ScrubState>(() => ({ fraction: 0, active: false, dragging: null }));
}

/** Web: атрибут маркера карты — касание маркера не скрывает курсор профиля (слушатель `document` графика). */
export const SCRUB_MARKER_ATTR = 'data-scrub-marker';

/** Вид карты для оверлеев (routes-04b, RC-4): пиксели линии показа при текущей камере; `null` — ещё не известны. */
export interface MapViewState {
  points: Planar[] | null;
}

export type MapViewStore = StoreApi<MapViewState>;

/**
 * Стор вида на экземпляр карты: пиксели линии пересчитываются на каждое изменение камеры, подписан только
 * `ScrubLayer` — `RouteMap` и источники на кадр камеры не перерисовываются. Не синглтон модуля (SSR — общий процесс).
 */
export function createMapViewStore(): MapViewStore {
  return createStore<MapViewState>(() => ({ points: null }));
}
