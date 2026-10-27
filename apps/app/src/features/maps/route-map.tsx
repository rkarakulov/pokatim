import type * as MapLibreNative from '@maplibre/maplibre-react-native';
import { space } from '@pokatim/design-tokens';
import { cumulativeMeters } from '@pokatim/tracks';
import { useReducedMotion } from '@rkarakulov/ui';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import {
  CORRIDOR_LAYER_ID,
  MAP_FIT_PADDING,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from './corridor-style';
import { loadMapLibreNative } from './load-maplibre-native';
import {
  clampZoom,
  MAP_CAMERA_ANIMATION_MS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_ZOOM_STEP,
  type MapViewSize,
} from './map-camera';
import { MapControls } from './map-controls';
import { MapGestureLockContext } from './map-gesture-lock';
import { cameraCall, useMapGestures, type MapViewSnapshot } from './map-gestures';
import { createMapViewStore } from './map-view-store';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';
import { mercatorProjector, projectLine } from './scrub-line';
import { ScrubLayer } from './scrub-layer';
import {
  TRACK_BEFORE_LAYER_ID,
  TRACK_SOURCE_ID,
  trackFeatures,
  trackLayers,
  unionBounds,
} from './track-style';

/** Кнопка атрибуции «i» — в нижнем правом углу, как на web: отступ камеры снизу её учитывает (B2 maps-02). */
const ATTRIBUTION_POSITION = { bottom: space.s2, right: space.s2 };

const styles = StyleSheet.create({
  // касания мимо маркера проходят к карте (кнопка атрибуции «i»)
  overlay: { ...StyleSheet.absoluteFill, pointerEvents: 'box-none' },
});

/**
 * Native-карта маршрута (`@maplibre/maplibre-react-native` 11, ADR-0014): пакет грузится лениво (`loadMapLibreNative`,
 * вызывающий проверяет `mapSupported()`). Интерактивная (routes-04b, RC-2): нативные жесты карты выключены пропсами
 * (один палец забирал бы прокрутку страницы; не `pointerEvents` — кнопка атрибуции нажимается), перетаскивание и
 * щипок двумя пальцами, двойной тап — RNGH поверх карты (`useMapGestures`), камера — императивно через `CameraRef`;
 * на время жеста экран не прокручивается (`MapGestureLockContext`). Зум `MAP_MIN_ZOOM…MAP_MAX_ZOOM`, кнопки «+», «−»,
 * «в рамку» с явной длительностью (по умолчанию `fitBounds` — 2 с `'fly'`), при reduce motion — без анимации.
 * Начальная камера — по рамке без анимации. Смена стиля (темы) — новая карта (`key` у вызывающего): сброс ошибки и
 * камеры. `scrub` (routes-04) — маркер скраббинга оверлеем над холстом: пиксели линии — `mercatorProjector` по
 * видимой рамке камеры (`onRegionIsChanging`/`onRegionDidChange`) и размеру вида в стор вида (подписан только
 * `ScrubLayer`) — карта на кадр камеры не перерисовывается.
 */
export function RouteMap({
  map,
  styleUrl,
  theme,
  accessibilityLabel,
  failedMessage,
  corridor = true,
  lineWidth,
  track,
  scrub,
}: RouteMapProps) {
  const [lib, setLib] = useState<typeof MapLibreNative | null>(null);
  const [failed, setFailed] = useState(false);
  // GeoJSONSource сериализует `data` в строку на каждом рендере — только при смене маршрута или темы
  const features = useMemo(() => routeFeatures(map), [map]);
  const layers = useMemo(
    () =>
      routeLayers(theme, map.widthM, map.bounds, lineWidth).filter(
        (layer) => corridor || layer.id !== CORRIDOR_LAYER_ID,
      ),
    [theme, map, corridor, lineWidth],
  );
  const trackData = useMemo(() => (track ? trackFeatures(track) : null), [track]);
  const trackStyle = useMemo(() => trackLayers(theme), [theme]);
  const bounds = useMemo(() => unionBounds(map.bounds, track?.line), [map, track]);
  const cumulative = useMemo(() => cumulativeMeters(map.line), [map]);

  // routes-04b (RC-4): камера и размер вида — в ref (кадр камеры не перерисовывает карту), пиксели линии — в стор вида
  const mapRef = useRef<MapLibreNative.MapRef>(null);
  const cameraRef = useRef<MapLibreNative.CameraRef>(null);
  const viewState = useRef<MapViewSnapshot | null>(null);
  const viewSize = useRef<MapViewSize | null>(null);
  const [view] = useState(createMapViewStore);
  const reproject = useCallback(() => {
    const state = viewState.current;
    const size = viewSize.current;
    if (!scrub || !state || !size) return;
    view.setState({
      points: projectLine(map.line, mercatorProjector(state.bounds, size.width, size.height)),
    });
  }, [scrub, map, view]);
  const onRegion = useCallback(
    (event: { nativeEvent: MapViewSnapshot }) => {
      viewState.current = event.nativeEvent;
      reproject();
    },
    [reproject],
  );
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      viewSize.current = { width, height };
      reproject();
    },
    [reproject],
  );

  const reduced = useReducedMotion();
  // `null` (ответа ещё нет) — как «уменьшить» (RC-9)
  const reduceMotion = reduced !== false;
  const duration = reduceMotion ? 0 : MAP_CAMERA_ANIMATION_MS;
  const onMapGesture = useContext(MapGestureLockContext);
  const gestures = useMapGestures({
    camera: cameraRef,
    view: viewState,
    size: viewSize,
    reduceMotion,
    onActive: onMapGesture,
  });
  const zoomBy = (delta: number) => {
    const zoomTo = (zoom: number) =>
      cameraRef.current?.zoomTo(clampZoom(zoom + delta), { duration, easing: 'ease' });
    const zoom = viewState.current?.zoom;
    // зум из событий региона; до первого события — у карты
    cameraCall(() => (zoom === undefined ? mapRef.current?.getZoom().then(zoomTo) : zoomTo(zoom)));
  };

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
        <GestureDetector gesture={gestures}>
          <View
            testID="map-gesture-area"
            style={StyleSheet.absoluteFill}
            collapsable={false}
            onLayout={onLayout}
          >
            <lib.Map
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              mapStyle={styleUrl}
              attribution
              attributionPosition={ATTRIBUTION_POSITION}
              // B4 maps-02: кнопка атрибуции — в цвете темы
              tintColor={theme.text.secondary}
              logo={false}
              compass={false}
              scaleBar={false}
              // нативные жесты — выключены: жесты двумя пальцами ведёт RNGH (`useMapGestures`, RC-2)
              dragPan={false}
              touchZoom={false}
              doubleTapZoom={false}
              doubleTapHoldZoom={false}
              touchRotate={false}
              touchPitch={false}
              onDidFailLoadingMap={() => setFailed(true)}
              onDidFinishLoadingMap={() => {
                mapRef.current
                  ?.getViewState()
                  .then((state) => {
                    viewState.current = state;
                    reproject();
                  })
                  .catch(() => undefined);
              }}
              onRegionIsChanging={onRegion}
              onRegionDidChange={onRegion}
            >
              <lib.Camera
                ref={cameraRef}
                minZoom={MAP_MIN_ZOOM}
                maxZoom={MAP_MAX_ZOOM}
                initialViewState={{ bounds, padding: MAP_FIT_PADDING }}
              />
              <lib.GeoJSONSource id={ROUTE_SOURCE_ID} data={features}>
                {layers.map((layer) => (
                  <lib.Layer key={layer.id} {...layer} />
                ))}
              </lib.GeoJSONSource>
              {trackData ? (
                // трек — под старт и финиш маршрута; смена трека — новая карта (`key` у вызывающего, RC-5)
                <lib.GeoJSONSource id={TRACK_SOURCE_ID} data={trackData}>
                  {trackStyle.map((layer) => (
                    <lib.Layer key={layer.id} {...layer} beforeId={TRACK_BEFORE_LAYER_ID} />
                  ))}
                </lib.GeoJSONSource>
              ) : null}
            </lib.Map>
          </View>
        </GestureDetector>
      ) : null}
      {lib && scrub ? (
        <View testID="scrub-overlay" style={styles.overlay} onLayout={onLayout}>
          <ScrubLayer view={view} store={scrub} cumulative={cumulative} theme={theme} />
        </View>
      ) : null}
      {lib && !failed ? (
        <MapControls
          theme={theme}
          onZoomIn={() => zoomBy(MAP_ZOOM_STEP)}
          onZoomOut={() => zoomBy(-MAP_ZOOM_STEP)}
          onFit={() =>
            cameraCall(() =>
              cameraRef.current?.fitBounds(bounds, {
                padding: MAP_FIT_PADDING,
                duration,
                easing: 'ease',
              }),
            )
          }
        />
      ) : null}
    </RouteMapFrame>
  );
}
