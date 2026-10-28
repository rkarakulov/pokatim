import type * as MapLibreNative from '@maplibre/maplibre-react-native';
import {
  cameraCall,
  cameraPadding,
  type CameraPadding,
  clampZoom,
  CORRIDOR_LAYER_ID,
  createMapViewStore,
  MAP_CAMERA_ANIMATION_MS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_ZOOM_STEP,
  type MapViewSize,
  type MapViewSnapshot,
  mercatorProjector,
  projectLine,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from '@pokatim/route-view';
import { cumulativeMeters } from '@pokatim/tracks';
import { useReducedMotion } from '@rkarakulov/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { loadMapLibreNative } from './load-maplibre-native';
import { LocationLayer } from './location-layer';
import { createLocationStore } from './location-store';
import { LOCATE_ZOOM } from './location-style';
import { MapAttributionButton } from './map-attribution-button';
import { MapOverlayControls } from './map-overlay-controls';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';
import { ScrubLayer } from './scrub-layer';
import {
  TRACK_BEFORE_LAYER_ID,
  TRACK_SOURCE_ID,
  trackFeatures,
  trackLayers,
  unionBounds,
} from './track-style';

const styles = StyleSheet.create({
  // касания мимо маркера проходят к карте
  overlay: { ...StyleSheet.absoluteFill, pointerEvents: 'box-none' },
});

/**
 * Native-карта маршрута (`@maplibre/maplibre-react-native` 11, ADR-0014): пакет грузится лениво (`loadMapLibreNative`,
 * вызывающий проверяет `mapSupported()`). Интерактивная (routes-04b; routes-04c — решение пользователя «одним
 * пальцем»): нативные жесты MapLibre — перетаскивание одним пальцем, щипок, двойной тап (при reduce motion выключен:
 * анимация нативная); вращение и наклон выключены. Касание карты забирает жест у прокрутки экрана (Android —
 * `requestDisallowInterceptTouchEvent` при `dragPan`, iOS — распознаватель карты глубже `UIScrollView`), вне карты
 * страница прокручивается. Зум `MAP_MIN_ZOOM…MAP_MAX_ZOOM` (`Camera`, ограничивает и жесты), кнопки «+», «−»,
 * «в рамку» с явной длительностью (по умолчанию `fitBounds` — 2 с `'fly'`), при reduce motion — без анимации.
 * Начальная камера — по рамке без анимации. Смена стиля (темы) — новая карта (`key` у вызывающего): сброс ошибки и
 * камеры. `scrub` (routes-04) — маркер скраббинга оверлеем над холстом: пиксели линии — `mercatorProjector` по
 * видимой рамке камеры (`onRegionIsChanging`/`onRegionDidChange`) и размеру вида в стор вида (подписан только
 * `ScrubLayer`) — карта на кадр камеры не перерисовывается. routes-04d: `fill` — карта на всю область, монтируется
 * после раскладки (высота нужна начальной камере, `cameraPadding` с `bottomInset`); «Моё местоположение» — кнопка
 * `MapOverlayControls`, точка — `LocationLayer` (стор позиции на экземпляр, карта при новой точке не
 * перерисовывается), камера — `easeTo` с явным `padding`.
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
  fill = false,
  bottomInset = 0,
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
  // routes-04d: точка позиции — в сторе (подписан только `LocationLayer`); высота шторки — в ref для кнопок камеры
  const [location] = useState(createLocationStore);
  const inset = useRef(bottomInset);
  useEffect(() => {
    inset.current = bottomInset;
  }, [bottomInset]);
  // начальная камера; `fill` — ей нужна высота карты: карта монтируется после раскладки области
  const [initialPadding, setInitialPadding] = useState<CameraPadding | null>(() =>
    fill ? null : cameraPadding(0, null),
  );
  const padding = () => cameraPadding(inset.current, viewSize.current?.height ?? null);
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
      setInitialPadding((current) => current ?? cameraPadding(inset.current, height));
      reproject();
    },
    [reproject],
  );

  const reduced = useReducedMotion();
  // `null` (ответа ещё нет) — как «уменьшить» (RC-9)
  const reduceMotion = reduced !== false;
  const duration = reduceMotion ? 0 : MAP_CAMERA_ANIMATION_MS;
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
      fill={fill}
      bottomInset={bottomInset}
    >
      {lib ? (
        <View testID="map-area" style={StyleSheet.absoluteFill} onLayout={onLayout}>
          {initialPadding ? (
            <lib.Map
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              mapStyle={styleUrl}
              // атрибуция «i» — своя кнопка `MapAttributionButton` (нижний левый угол, над шторкой — RC-6)
              attribution={false}
              logo={false}
              compass={false}
              scaleBar={false}
              // routes-04c: нативные жесты — один палец двигает карту, щипок — зум; двойной тап анимирует камеру
              // нативно — при reduce motion выключен (кнопки «+», «−» — без анимации)
              dragPan
              touchZoom
              doubleTapZoom={!reduceMotion}
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
                initialViewState={{ bounds, padding: initialPadding }}
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
              <LocationLayer lib={lib} store={location} theme={theme} />
            </lib.Map>
          ) : null}
        </View>
      ) : null}
      {lib && scrub ? (
        <View testID="scrub-overlay" style={styles.overlay} onLayout={onLayout}>
          <ScrubLayer view={view} store={scrub} cumulative={cumulative} theme={theme} />
        </View>
      ) : null}
      {lib ? (
        <MapAttributionButton
          theme={theme}
          bottomInset={bottomInset}
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
              cameraRef.current?.fitBounds(bounds, {
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
  );
}
