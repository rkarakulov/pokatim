import type * as MapLibreNative from '@maplibre/maplibre-react-native';
import type { AppTheme } from '@pokatim/design-tokens';
import { useMemo } from 'react';

import { useLocation, type LocationStore } from './location-store';
import { LOCATION_SOURCE_ID, locationFeature, locationLayers } from './location-style';

/**
 * Слой точки «Моё местоположение» на native-карте (routes-04d, RC-13): дочерний `lib.Map`, единственный подписчик
 * стора позиции — новая точка перерисовывает только его. Точки нет — слоя нет.
 */
export function LocationLayer({
  lib,
  store,
  theme,
}: {
  lib: typeof MapLibreNative;
  store: LocationStore;
  theme: AppTheme;
}) {
  const lngLat = useLocation(store, (state) => state.lngLat);
  const data = useMemo(() => (lngLat ? locationFeature(lngLat) : null), [lngLat]);
  const layers = useMemo(() => locationLayers(theme), [theme]);
  if (!data) return null;
  return (
    <lib.GeoJSONSource id={LOCATION_SOURCE_ID} data={data}>
      {layers.map((layer) => (
        <lib.Layer key={layer.id} {...layer} />
      ))}
    </lib.GeoJSONSource>
  );
}
