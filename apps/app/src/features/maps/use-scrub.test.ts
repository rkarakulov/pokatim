/// <reference types="jest" />
import { createScrubStore } from '@pokatim/route-view';
import { act, renderHook } from '@testing-library/react-native';
import { useScrub } from './use-scrub';

describe('useScrub (routes-04, RC-5)', () => {
  it('setState сливает поля; подписчик по селектору видит только своё поле', async () => {
    const store = createScrubStore();
    const { result } = await renderHook(() => useScrub(store, (state) => state.active));
    expect(result.current).toBe(false);
    await act(async () => store.setState({ fraction: 0.3, active: true }));
    expect(result.current).toBe(true);
    expect(store.getState()).toEqual({ fraction: 0.3, active: true, dragging: null });
  });
});
