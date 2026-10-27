import { describe, expect, it, vi } from 'vitest';

import { createMapViewStore, createScrubStore } from './stores.ts';

describe('сторы скраббинга и вида карты (routes-04, RC-5; routes-04b, RC-4)', () => {
  it('начальное состояние — старт, курсор скрыт, жеста нет; экземпляры независимы', () => {
    const store = createScrubStore();
    expect(store.getState()).toEqual({ fraction: 0, active: false, dragging: null });
    store.setState({ fraction: 0.5 });
    expect(createScrubStore().getState().fraction).toBe(0);
  });

  it('setState сливает поля, подписчик получает новое состояние; вид карты — без пикселей до камеры', () => {
    const store = createScrubStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ fraction: 0.3, active: true });
    expect(store.getState()).toEqual({ fraction: 0.3, active: true, dragging: null });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createMapViewStore().getState()).toEqual({ points: null });
  });
});
