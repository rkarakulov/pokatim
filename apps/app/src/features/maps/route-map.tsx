import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { MAP_PADDING, ROUTE_SOURCE_ID, routeFeatures, routeLayers } from './corridor-style';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';

const padding = { top: MAP_PADDING, right: MAP_PADDING, bottom: MAP_PADDING, left: MAP_PADDING };

/**
 * Native-карта маршрута (`@maplibre/maplibre-react-native` 11, ADR-0014): статичный вид — жесты выключены пропсами
 * (не `pointerEvents`: кнопка атрибуции остаётся нажимаемой, RC-6), камера сразу по рамке без анимации (RC-4).
 * Смена темы — новый `mapStyle`, слои-дети библиотека добавляет заново.
 */
export function RouteMap({
  map,
  styleUrl,
  theme,
  accessibilityLabel,
  failedMessage,
}: RouteMapProps) {
  const [failed, setFailed] = useState(false);
  return (
    <RouteMapFrame
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failed ? failedMessage : null}
    >
      <Map
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
        <Camera initialViewState={{ bounds: map.bounds, padding }} />
        <GeoJSONSource id={ROUTE_SOURCE_ID} data={routeFeatures(map)}>
          {routeLayers(theme, map.widthM, map.bounds).map((layer) => (
            <Layer key={layer.id} {...layer} />
          ))}
        </GeoJSONSource>
      </Map>
    </RouteMapFrame>
  );
}
