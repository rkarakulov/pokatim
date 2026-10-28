import type * as MapLibreNative from '@maplibre/maplibre-react-native';
import {
  cameraCall,
  cameraPadding,
  type CameraPadding,
  clampZoom,
  MAP_CAMERA_ANIMATION_MS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_ZOOM_STEP,
} from '@pokatim/route-view';
import { useReducedMotion } from '@rkarakulov/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { loadMapLibreNative } from '@/features/maps/load-maplibre-native';
import { LocationLayer } from '@/features/maps/location-layer';
import { createLocationStore } from '@/features/maps/location-store';
import { LOCATE_ZOOM } from '@/features/maps/location-style';
import { MapAttributionButton } from '@/features/maps/map-attribution-button';
import { MapOverlayControls } from '@/features/maps/map-overlay-controls';
import { RouteMapFrame } from '@/features/maps/route-map-frame';

import { RidePointCard } from './ride-point-card';
import type { RidePointsMapProps } from './ride-points-map-props';
import {
  RIDE_POINTS_SOURCE_ID,
  rideGroups,
  ridePointFeatures,
  ridePointLayers,
} from './ride-points-style';

/**
 * Native-карта точек старта ленты райдов (05c, `@maplibre/maplibre-react-native` 11; вызывающий проверяет
 * `mapSupported()`): пакет — лениво (`loadMapLibreNative`), жесты и атрибуция — как у карты маршрута (`RouteMap`),
 * карта на всю область (монтируется после раскладки: отступ камеры по высоте). Точки — один `GeoJSONSource`
 * (одинаковый старт — одна точка с числом, RC-11); нажатие — `onPress` источника (v11: `nativeEvent.features`) →
 * выбор группы в листовом состоянии и карточка под картой. Позиция «Рядом» (`me`) — `LocationLayer` через стор
 * экземпляра (не в подписях и логах). Кнопки камеры и «Моё местоположение» — `MapOverlayControls`.
 */
export function RidePointsMap({
  points,
  me,
  bounds,
  styleUrl,
  theme,
  accessibilityLabel,
  failedMessage,
  now,
  onOpen,
}: RidePointsMapProps) {
  const [lib, setLib] = useState<typeof MapLibreNative | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const features = useMemo(() => ridePointFeatures(points), [points]);
  const groups = useMemo(() => rideGroups(points), [points]);
  const layers = useMemo(() => ridePointLayers(theme), [theme]);
  const group = selected ? groups.get(selected) : undefined;

  const mapRef = useRef<MapLibreNative.MapRef>(null);
  const cameraRef = useRef<MapLibreNative.CameraRef>(null);
  const zoomRef = useRef<number | undefined>(undefined);
  const height = useRef<number | null>(null);
  const [initialPadding, setInitialPadding] = useState<CameraPadding | null>(null);
  const [location] = useState(createLocationStore);
  useEffect(() => {
    location.setState({ lngLat: me });
  }, [location, me]);

  const reduced = useReducedMotion();
  const reduceMotion = reduced !== false;
  const duration = reduceMotion ? 0 : MAP_CAMERA_ANIMATION_MS;
  const padding = () => cameraPadding(0, height.current);
  const zoomBy = (delta: number) => {
    const zoomTo = (zoom: number) =>
      cameraRef.current?.zoomTo(clampZoom(zoom + delta), { duration, easing: 'ease' });
    const zoom = zoomRef.current;
    cameraCall(() => (zoom === undefined ? mapRef.current?.getZoom().then(zoomTo) : zoomTo(zoom)));
  };
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    height.current = event.nativeEvent.layout.height;
    setInitialPadding((current) => current ?? cameraPadding(0, height.current));
  }, []);

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
    <View style={styles.area}>
      <RouteMapFrame
        theme={theme}
        accessibilityLabel={accessibilityLabel}
        failedMessage={failed ? failedMessage : null}
        fill
      >
        {lib ? (
          <View testID="map-area" style={StyleSheet.absoluteFill} onLayout={onLayout}>
            {initialPadding ? (
              <lib.Map
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                mapStyle={styleUrl}
                attribution={false}
                logo={false}
                compass={false}
                scaleBar={false}
                dragPan
                touchZoom
                doubleTapZoom={!reduceMotion}
                doubleTapHoldZoom={false}
                touchRotate={false}
                touchPitch={false}
                onDidFailLoadingMap={() => setFailed(true)}
                onRegionDidChange={(event) => {
                  zoomRef.current = event.nativeEvent.zoom;
                }}
              >
                <lib.Camera
                  ref={cameraRef}
                  minZoom={MAP_MIN_ZOOM}
                  maxZoom={MAP_MAX_ZOOM}
                  initialViewState={{ bounds: [...bounds], padding: initialPadding }}
                />
                <lib.GeoJSONSource
                  id={RIDE_POINTS_SOURCE_ID}
                  data={features}
                  onPress={(event) => {
                    const key = event.nativeEvent.features[0]?.properties?.key;
                    if (typeof key === 'string') setSelected(key);
                  }}
                >
                  {layers.map((layer) => (
                    <lib.Layer key={layer.id} {...layer} />
                  ))}
                </lib.GeoJSONSource>
                <LocationLayer lib={lib} store={location} theme={theme} />
              </lib.Map>
            ) : null}
          </View>
        ) : null}
        {lib ? (
          <MapAttributionButton
            theme={theme}
            onPress={() => mapRef.current?.showAttribution().catch(() => undefined)}
          />
        ) : null}
        {lib && !failed ? (
          <MapOverlayControls
            theme={theme}
            onZoomIn={() => zoomBy(MAP_ZOOM_STEP)}
            onZoomOut={() => zoomBy(-MAP_ZOOM_STEP)}
            onFit={() =>
              cameraCall(() =>
                cameraRef.current?.fitBounds([...bounds], {
                  padding: padding(),
                  duration,
                  easing: 'ease',
                }),
              )
            }
            onPosition={(lngLat) => {
              location.setState({ lngLat });
              cameraCall(() =>
                cameraRef.current?.easeTo({
                  center: [lngLat[0], lngLat[1]],
                  zoom: LOCATE_ZOOM,
                  padding: padding(),
                  duration,
                  easing: 'ease',
                }),
              );
            }}
          />
        ) : null}
      </RouteMapFrame>
      {group ? (
        <RidePointCard
          rides={group}
          now={now}
          theme={theme}
          onOpen={onOpen}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1 },
});
