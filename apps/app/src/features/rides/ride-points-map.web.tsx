import 'maplibre-gl/dist/maplibre-gl.css';

import {
  attributionPanelCss,
  cameraPadding,
  collapseAttribution,
  interactiveMapOptions,
} from '@pokatim/route-view';
import { useReducedMotion } from '@rkarakulov/ui';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { loadMaplibre } from '@/features/maps/load-maplibre';
import {
  LOCATE_ZOOM,
  LOCATION_SOURCE_ID,
  locationFeature,
  locationLayers,
} from '@/features/maps/location-style';
import { MapAttributionButton } from '@/features/maps/map-attribution-button';
import { MapOverlayControls } from '@/features/maps/map-overlay-controls';
import { MAP_WORKER_FILE } from '@/features/maps/map-worker';
import { RouteMapFrame } from '@/features/maps/route-map-frame';

import { RidePointCard } from './ride-point-card';
import type { RidePointsMapProps } from './ride-points-map-props';
import {
  RIDE_POINTS_LAYER_ID,
  RIDE_POINTS_SOURCE_ID,
  rideGroups,
  ridePointFeatures,
  ridePointLayers,
} from './ride-points-style';

/** Точка «Моё местоположение» / «Рядом»: источник при первой точке, дальше `setData`; до `load` стиля — пропуск. */
function showLocation(
  map: MapLibreMap,
  lngLat: readonly [number, number],
  theme: RidePointsMapProps['theme'],
) {
  const data = locationFeature(lngLat);
  try {
    const source = map.getSource<GeoJSONSource>(LOCATION_SOURCE_ID);
    if (source) source.setData(data);
    else {
      map.addSource(LOCATION_SOURCE_ID, { type: 'geojson', data });
      for (const layer of locationLayers(theme)) map.addLayer(layer);
    }
  } catch {
    // стиль ещё не загружен — точка появится на `load`
  }
}

/**
 * Web-карта точек старта ленты райдов (05c, `maplibre-gl` 6): модуль — динамическим `import()` после монтирования
 * (как `route-map.web.tsx`), карта на всю область — колесо масштабирует (страница под картой не прокручивается), атрибуция
 * — `AttributionControl` слева внизу, свёрнута, раскрывает её своя кнопка «i» (`MapAttributionButton`). После `load` —
 * источник и слои точек (одинаковый старт — одна точка с числом, RC-11) и точка позиции «Рядом» (`me`); клик по точке — выбор группы и карточка под картой, курсор `pointer`
 * над точкой. Смена стиля, точек или рамки — пересоздание карты (ключ у вызывающего не нужен). Ошибка до `load` —
 * сообщение поверх карты.
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
  const container = useRef<HTMLDivElement>(null);
  const scope = useId();
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useMemo(() => rideGroups(points), [points]);
  const group = selected ? groups.get(selected) : undefined;
  const instanceRef = useRef<MapLibreMap | null>(null);
  // своя кнопка «i» раскрывает и сворачивает плашку контрола атрибуции MapLibre
  const toggleAttribution = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const reduced = useReducedMotion();
  const animate = useRef(false);
  useEffect(() => {
    animate.current = reduced === false;
  }, [reduced]);
  // позиция «Рядом» — через ref: эффект создания карты от неё не зависит (смена — `setData`)
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
    const map = instanceRef.current;
    if (map && me) showLocation(map, me, theme);
  }, [me, theme]);
  const padding = () => cameraPadding(0, container.current?.clientHeight || null);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    setFailed(false);
    setSelected(null);
    loadMaplibre()
      .then(({ Map, AttributionControl, getVersion, setWorkerUrl }) => {
        if (cancelled) return;
        setWorkerUrl(`/${MAP_WORKER_FILE}?v=${getVersion()}`);
        const created = new Map({
          container: node,
          style: styleUrl,
          ...interactiveMapOptions({
            bounds,
            padding: cameraPadding(0, node.clientHeight || null),
          }),
          attributionControl: false,
        });
        created.addControl(new AttributionControl({ compact: true }), 'bottom-left');
        created.touchZoomRotate.disableRotation();
        created.keyboard.disableRotation();
        instance = created;
        instanceRef.current = created;
        setReady(true);
        toggleAttribution.current = collapseAttribution(created, node);
        let loaded = false;
        created.on('load', () => {
          loaded = true;
          created.addSource(RIDE_POINTS_SOURCE_ID, {
            type: 'geojson',
            data: ridePointFeatures(points),
          });
          for (const layer of ridePointLayers(theme)) created.addLayer(layer);
          if (meRef.current) showLocation(created, meRef.current, theme);
        });
        created.on('click', RIDE_POINTS_LAYER_ID, (event: MapLayerMouseEvent) => {
          const key = event.features?.[0]?.properties?.key;
          if (typeof key === 'string') setSelected(key);
        });
        created.on('mouseenter', RIDE_POINTS_LAYER_ID, () => {
          created.getCanvas().style.cursor = 'pointer';
        });
        created.on('mouseleave', RIDE_POINTS_LAYER_ID, () => {
          created.getCanvas().style.cursor = '';
        });
        created.on('error', () => {
          if (!loaded) setFailed(true);
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      instance?.remove();
      instanceRef.current = null;
      setReady(false);
    };
  }, [points, bounds, styleUrl, theme]);

  return (
    <View style={styles.area}>
      <RouteMapFrame
        theme={theme}
        accessibilityLabel={accessibilityLabel}
        failedMessage={failed ? failedMessage : null}
        fill
      >
        <style>{attributionPanelCss(scope, theme)}</style>
        <div
          ref={container}
          data-testid="ride-points-canvas"
          data-route-map={scope}
          style={canvasStyle}
        />
        {ready ? (
          <MapAttributionButton theme={theme} onPress={() => toggleAttribution.current?.()} />
        ) : null}
        {ready && !failed ? (
          <MapOverlayControls
            theme={theme}
            onZoomIn={() => instanceRef.current?.zoomIn({ animate: animate.current })}
            onZoomOut={() => instanceRef.current?.zoomOut({ animate: animate.current })}
            onFit={() =>
              instanceRef.current?.fitBounds([...bounds], {
                padding: padding(),
                animate: animate.current,
              })
            }
            onPosition={(lngLat) => {
              const map = instanceRef.current;
              if (!map) return;
              showLocation(map, lngLat, theme);
              map.easeTo({
                center: [lngLat[0], lngLat[1]],
                zoom: LOCATE_ZOOM,
                animate: animate.current,
              });
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

const canvasStyle = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  area: { flex: 1 },
});
