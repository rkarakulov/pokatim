import type { AppTheme } from '@pokatim/design-tokens';
import { type MapViewStore, type ScrubStore } from '@pokatim/route-view';
import { useStore } from 'zustand';

import { ScrubMarker } from './scrub-marker';

/**
 * Слой маркера скраббинга (routes-04b, RC-4, I4): единственный подписчик пикселей линии в сторе вида — на движение
 * камеры перерисовывается он и маркер, не карта. Пикселей ещё нет (камера или размер неизвестны) — маркера нет.
 */
export function ScrubLayer({
  view,
  store,
  cumulative,
  theme,
}: {
  view: MapViewStore;
  store: ScrubStore;
  cumulative: readonly number[];
  theme: AppTheme;
}) {
  const points = useStore(view, (state) => state.points);
  return points ? (
    <ScrubMarker store={store} points={points} cumulative={cumulative} theme={theme} />
  ) : null;
}
