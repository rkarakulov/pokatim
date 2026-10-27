import type { AppTheme } from '@pokatim/design-tokens';

import { MapControls } from './map-controls';
import { MapLocateNotice } from './map-locate-notice';
import { useLocate } from './use-locate';

/**
 * Кнопки камеры и «Моё местоположение» поверх карты (routes-04d, RC-13): состояние чтения позиции живёт в этом
 * листовом компоненте — нажатие, ожидание и сообщение отказа перерисовывают его, а не `RouteMap` с холстом.
 * Позиция уходит в `onPosition` (камера и точка), в состояние не попадает.
 */
export function MapOverlayControls({
  theme,
  onZoomIn,
  onZoomOut,
  onFit,
  onPosition,
}: {
  theme: AppTheme;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onPosition: (lngLat: readonly [number, number]) => void;
}) {
  const { state, locate } = useLocate(onPosition);
  return (
    <>
      <MapLocateNotice state={state} />
      <MapControls
        theme={theme}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFit={onFit}
        onLocate={locate}
        locating={state.status === 'pending'}
      />
    </>
  );
}
