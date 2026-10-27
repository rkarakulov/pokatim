import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface LocationState {
  /** последняя прочитанная позиция `[lng, lat]`; `null` — точки нет */
  lngLat: readonly [number, number] | null;
}

export type LocationStore = StoreApi<LocationState>;

/**
 * Точка «Моё местоположение» на экземпляр карты (routes-04d, RC-13): только память — без persist, без TanStack
 * Query, без логов. Подписан только слой точки (`LocationLayer`) — карта при новой точке не перерисовывается. Не
 * синглтон модуля (SSR — общий процесс): `RouteMap` создаёт свой.
 */
export function createLocationStore(): LocationStore {
  return createStore<LocationState>(() => ({ lngLat: null }));
}

export function useLocation<T>(store: LocationStore, select: (state: LocationState) => T): T {
  return useStore(store, select);
}
