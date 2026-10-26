import 'maplibre-gl/dist/maplibre-gl.css';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import {
  CORRIDOR_LAYER_ID,
  MAP_PADDING,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from './corridor-style';
import { loadMaplibre } from './load-maplibre';
import { MAP_WORKER_FILE } from './map-worker';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';

/**
 * Web-карта маршрута (`maplibre-gl` 6, ADR-0014 п. 5): модуль грузится динамическим `import()` только после
 * монтирования — в серверный рендер и первый чанк не попадает (статически — только CSS). Статичный вид
 * (`interactive: false`), компактная атрибуция, камера сразу по рамке без анимации (RC-4). Смена стиля (темы) —
 * пересоздание карты. Ошибка стиля или тайлов — сообщение поверх карты.
 */
export function RouteMap({
  map,
  styleUrl,
  theme,
  accessibilityLabel,
  failedMessage,
  corridor = true,
}: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

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
          bounds: map.bounds,
          fitBoundsOptions: { padding: MAP_PADDING, animate: false },
        });
        instance = created;
        created.on('load', () => {
          created.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: routeFeatures(map) });
          for (const layer of routeLayers(theme, map.widthM, map.bounds)) {
            if (corridor || layer.id !== CORRIDOR_LAYER_ID) created.addLayer(layer);
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
  }, [map, styleUrl, theme, corridor]);

  return (
    <RouteMapFrame
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failed ? failedMessage : null}
    >
      <div ref={container} data-testid="route-map-canvas" style={canvasStyle} />
    </RouteMapFrame>
  );
}

const canvasStyle = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
