import 'maplibre-gl/dist/maplibre-gl.css';

import { cumulativeMeters, type Planar } from '@pokatim/tracks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { attributionCss, collapseAttribution } from './attribution.web';
import {
  CORRIDOR_LAYER_ID,
  MAP_FIT_PADDING,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from './corridor-style';
import { loadMaplibre } from './load-maplibre';
import { MAP_WORKER_FILE } from './map-worker';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';
import { projectLine } from './scrub-line';
import { ScrubMarker } from './scrub-marker';
import {
  TRACK_BEFORE_LAYER_ID,
  TRACK_SOURCE_ID,
  trackFeatures,
  trackLayers,
  unionBounds,
} from './track-style';

/**
 * Web-карта маршрута (`maplibre-gl` 6, ADR-0014 п. 5): модуль грузится динамическим `import()` только после
 * монтирования — в серверный рендер и первый чанк не попадает (статически — только CSS). Статичный вид
 * (`interactive: false`), компактная атрибуция — свёрнута при старте и в цветах темы (B2, B4 maps-02), камера сразу
 * по рамке без анимации (RC-4) с отступом под контрол атрибуции. Смена стиля (темы) — пересоздание карты. Ошибка
 * стиля или тайлов — сообщение поверх карты. `scrub` (routes-04) — маркер скраббинга оверлеем: пиксели линии —
 * `map.project` после `load` и на `SCRUB_REPROJECT_EVENTS`; карта на стор не подписана и не пересоздаётся.
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
  const container = useRef<HTMLDivElement>(null);
  const scope = useId();
  const [failed, setFailed] = useState(false);
  // routes-04 (RC-2): пиксели линии для маркера скраббинга — после `load` и на `resize`; стор читается через ref:
  // в зависимостях эффекта создания карты его нет (иначе пересоздание карты)
  const withScrub = useRef(false);
  useEffect(() => {
    withScrub.current = scrub !== undefined;
  }, [scrub]);
  const [linePoints, setLinePoints] = useState<Planar[] | null>(null);
  const cumulative = useMemo(() => cumulativeMeters(map.line), [map]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    setFailed(false);
    loadMaplibre()
      .then(({ Map, getVersion, setWorkerUrl }) => {
        if (cancelled) return;
        setWorkerUrl(`/${MAP_WORKER_FILE}?v=${getVersion()}`);
        const created = new Map({
          container: node,
          style: styleUrl,
          interactive: false,
          attributionControl: { compact: true },
          bounds: unionBounds(map.bounds, track?.line),
          fitBoundsOptions: { padding: MAP_FIT_PADDING, animate: false },
        });
        instance = created;
        collapseAttribution(created, node);
        created.on('load', () => {
          created.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: routeFeatures(map) });
          for (const layer of routeLayers(theme, map.widthM, map.bounds, lineWidth)) {
            if (corridor || layer.id !== CORRIDOR_LAYER_ID) created.addLayer(layer);
          }
          if (track) {
            // трек — под старт и финиш маршрута
            created.addSource(TRACK_SOURCE_ID, { type: 'geojson', data: trackFeatures(track) });
            for (const layer of trackLayers(theme)) created.addLayer(layer, TRACK_BEFORE_LAYER_ID);
          }
          if (withScrub.current) {
            // одна функция пересчёта на любое изменение камеры (routes-04b добавит `move` в список событий)
            const reproject = () =>
              setLinePoints(
                projectLine(map.line, (point) => {
                  const { x, y } = created.project(point);
                  return [x, y];
                }),
              );
            reproject();
            for (const event of SCRUB_REPROJECT_EVENTS) created.on(event, reproject);
          }
        });
        created.on('error', () => setFailed(true));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      instance?.remove();
    };
  }, [map, styleUrl, theme, corridor, lineWidth, track]);

  return (
    <RouteMapFrame
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failed ? failedMessage : null}
    >
      <style>{attributionCss(scope, theme)}</style>
      <div
        ref={container}
        data-testid="route-map-canvas"
        data-route-map={scope}
        style={canvasStyle}
      />
      {scrub && linePoints ? (
        <ScrubMarker store={scrub} points={linePoints} cumulative={cumulative} theme={theme} />
      ) : null}
    </RouteMapFrame>
  );
}

/** События камеры, после которых пиксели линии маркера пересчитываются (карта статична — только размер). */
const SCRUB_REPROJECT_EVENTS = ['resize'] as const;

const canvasStyle = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
