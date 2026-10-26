import type * as MapLibreNative from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  CORRIDOR_LAYER_ID,
  MAP_PADDING,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from './corridor-style';
import { loadMapLibreNative } from './load-maplibre-native';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';

const padding = { top: MAP_PADDING, right: MAP_PADDING, bottom: MAP_PADDING, left: MAP_PADDING };

/**
 * Native-карта маршрута (`@maplibre/maplibre-react-native` 11, ADR-0014): пакет грузится лениво (`loadMapLibreNative`,
 * вызывающий проверяет `mapSupported()`). Статичный вид — жесты выключены пропсами (не `pointerEvents`: кнопка
 * атрибуции остаётся нажимаемой, RC-6), камера сразу по рамке без анимации (RC-4). Смена стиля (темы) — новая
 * карта (`key` у вызывающего): сброс ошибки прошлого стиля.
 */
export function RouteMap({
  map,
  styleUrl,
  theme,
  accessibilityLabel,
  failedMessage,
  corridor = true,
}: RouteMapProps) {
  const [lib, setLib] = useState<typeof MapLibreNative | null>(null);
  const [failed, setFailed] = useState(false);
  // GeoJSONSource сериализует `data` в строку на каждом рендере — только при смене маршрута или темы
  const features = useMemo(() => routeFeatures(map), [map]);
  const layers = useMemo(
    () =>
      routeLayers(theme, map.widthM, map.bounds).filter(
        (layer) => corridor || layer.id !== CORRIDOR_LAYER_ID,
      ),
    [theme, map, corridor],
  );

  useEffect(() => {
    let cancelled = false;
    loadMapLibreNative()
      .then((loaded) => {
        if (!cancelled) setLib(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RouteMapFrame
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failed ? failedMessage : null}
    >
      {lib ? (
        <lib.Map
          style={StyleSheet.absoluteFill}
          mapStyle={styleUrl}
          attribution
          logo={false}
          compass={false}
          scaleBar={false}
          dragPan={false}
          touchZoom={false}
          doubleTapZoom={false}
          doubleTapHoldZoom={false}
          touchRotate={false}
          touchPitch={false}
          onDidFailLoadingMap={() => setFailed(true)}
        >
          <lib.Camera initialViewState={{ bounds: map.bounds, padding }} />
          <lib.GeoJSONSource id={ROUTE_SOURCE_ID} data={features}>
            {layers.map((layer) => (
              <lib.Layer key={layer.id} {...layer} />
            ))}
          </lib.GeoJSONSource>
        </lib.Map>
      ) : null}
    </RouteMapFrame>
  );
}
