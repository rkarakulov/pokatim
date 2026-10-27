import type { Planar } from '@pokatim/tracks';
import { createStore, type StoreApi } from 'zustand/vanilla';

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
