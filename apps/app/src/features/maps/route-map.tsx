import type * as MapLibreNative from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { space } from '@pokatim/design-tokens';
import { cumulativeMeters } from '@pokatim/tracks';
import { StyleSheet, View } from 'react-native';

import {
  CORRIDOR_LAYER_ID,
  MAP_FIT_PADDING,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from './corridor-style';
import { loadMapLibreNative } from './load-maplibre-native';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';
import { ScrubMarker } from './scrub-marker';
import { mercatorProjector, projectLine } from './scrub-line';
import {
  TRACK_BEFORE_LAYER_ID,
  TRACK_SOURCE_ID,
  trackFeatures,
  trackLayers,
  unionBounds,
} from './track-style';

/** Кнопка атрибуции «i» — в нижнем правом углу, как на web: отступ камеры снизу её учитывает (B2 maps-02). */
const ATTRIBUTION_POSITION = { bottom: space.s2, right: space.s2 };

/** Видимая рамка карты `[запад, юг, восток, север]` (`ViewState.bounds` MapLibre RN 11). */
type ViewBounds = readonly [west: number, south: number, east: number, north: number];

const styles = StyleSheet.create({
  // касания мимо маркера проходят к карте (кнопка атрибуции «i»)
  overlay: { ...StyleSheet.absoluteFill, pointerEvents: 'box-none' },
});

/**
 * Native-карта маршрута (`@maplibre/maplibre-react-native` 11, ADR-0014): пакет грузится лениво (`loadMapLibreNative`,
 * вызывающий проверяет `mapSupported()`). Статичный вид — жесты выключены пропсами (не `pointerEvents`: кнопка
 * атрибуции остаётся нажимаемой, RC-6), камера сразу по рамке без анимации (RC-4). Смена стиля (темы) — новая
 * карта (`key` у вызывающего): сброс ошибки прошлого стиля. `scrub` (routes-04) — маркер скраббинга оверлеем над
 * холстом: пиксели линии — `mercatorProjector` по видимой рамке камеры и размеру оверлея; карта на стор не подписана.
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
  // routes-04 (RC-2): маркер скраббинга — оверлей в пикселях; проекция по видимой рамке статичной камеры и размеру
  const mapRef = useRef<MapLibreNative.MapRef>(null);
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);
  const [viewSize, setViewSize] = useState<{ width: number; height: number } | null>(null);
  const cumulative = useMemo(() => cumulativeMeters(map.line), [map]);
  const linePoints = useMemo(() => {
    if (!viewBounds || !viewSize) return null;
    // одна функция пересчёта: рамка камеры или размер изменились (routes-04b добавит onRegionIsChanging)
    return projectLine(map.line, mercatorProjector(viewBounds, viewSize.width, viewSize.height));
  }, [map, viewBounds, viewSize]);

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
          attributionPosition={ATTRIBUTION_POSITION}
          // B4 maps-02: кнопка атрибуции — в цвете темы
          tintColor={theme.text.secondary}
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
          {...(scrub
            ? {
                ref: mapRef,
                onDidFinishLoadingMap: () => {
                  mapRef.current
                    ?.getViewState()
                    .then((state) => setViewBounds(state.bounds))
                    .catch(() => undefined);
                },
                onRegionDidChange: (event: { nativeEvent: { bounds: ViewBounds } }) =>
                  setViewBounds(event.nativeEvent.bounds),
              }
            : {})}
        >
          <lib.Camera initialViewState={{ bounds, padding: MAP_FIT_PADDING }} />
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
      ) : null}
      {lib && scrub ? (
        <View
          testID="scrub-overlay"
          style={styles.overlay}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setViewSize({ width, height });
          }}
        >
          {linePoints ? (
            <ScrubMarker store={scrub} points={linePoints} cumulative={cumulative} theme={theme} />
          ) : null}
        </View>
      ) : null}
    </RouteMapFrame>
  );
}
