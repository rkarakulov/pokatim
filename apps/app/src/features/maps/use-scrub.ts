import type { ScrubState, ScrubStore } from '@pokatim/route-view';
import { useStore } from 'zustand';

/**
 * Подписка на стор скраббинга (`createScrubStore` — `@pokatim/route-view`, routes-04 RC-5): перерисовываются только
 * подписчики селектора — не карта и не экран.
 */
export function useScrub<T>(store: ScrubStore, select: (state: ScrubState) => T): T {
  return useStore(store, select);
}
