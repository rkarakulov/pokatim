/// <reference types="jest" />
import { act, renderHook } from '@testing-library/react-native';

import { createScrubStore, useScrub } from './scrub-store';

describe('scrub-store (routes-04, RC-5)', () => {
  it('начальное состояние — старт, курсор скрыт, жеста нет; экземпляры независимы', () => {
    const store = createScrubStore();
    expect(store.getState()).toEqual({ fraction: 0, active: false, dragging: null });
    store.setState({ fraction: 0.5 });
    expect(createScrubStore().getState().fraction).toBe(0);
  });

  it('setState сливает поля; подписчик по селектору видит только своё поле', async () => {
    const store = createScrubStore();
    const { result } = await renderHook(() => useScrub(store, (state) => state.active));
    expect(result.current).toBe(false);
    await act(async () => store.setState({ fraction: 0.3, active: true }));
    expect(result.current).toBe(true);
    expect(store.getState()).toEqual({ fraction: 0.3, active: true, dragging: null });
  });
});
