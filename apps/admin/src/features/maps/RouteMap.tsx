import type { RouteMapGeometry } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import {
  attributionCss,
  collapseAttribution,
  CORRIDOR_LAYER_ID,
  createMapViewStore,
  guardWheelZoom,
  interactiveMapOptions,
  isMacPlatform,
  MAP_ASPECT_RATIO,
  MAP_FIT_PADDING,
  projectLine,
  ROUTE_CATALOG_LINE_WIDTH,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
  type ScrubStore,
  WHEEL_HINT_MS,
} from '@pokatim/route-view';
import { cumulativeMeters } from '@pokatim/tracks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { loadMaplibre } from './load-maplibre';
import { MapControls } from './MapControls';
import { PANEL_MAP_THEME } from './panel-map-theme';
import { ScrubLayer } from './ScrubMarker';
import { useReducedMotion } from './use-reduced-motion';

/** События камеры, после которых пиксели линии маркера пересчитываются (`move` — и перетаскивание, и зум). */
const SCRUB_REPROJECT_EVENTS = ['resize', 'move'] as const;

/**
 * Карта маршрута панели (routes-05, A2; по образцу web приложения routes-04b/04c): `maplibre-gl` 6 грузится лениво
 * (`loadMaplibre`, отдельный чанк) после монтирования. Мышь и один палец двигают карту, колесо — зум только с Ctrl/⌘
 * (без модификатора — прокрутка страницы и подсказка, `guardWheelZoom`), вращение и наклон выключены, зум 2–17;
 * кнопки «+», «−», «в рамку» (без анимации при reduce motion). Линия маршрута 5 px, старт и финиш — как в приложении,
 * без коридора; цвета — роли `themes.panel.map.*`. Ошибка до `load` (стиль, первые тайлы) — сообщение поверх карты;
 * после `load` — без сообщения. `scrub` — маркер скраббинга оверлеем: пиксели линии — `map.project` после `load` и на
 * `resize`/`move` в стор вида (подписан только `ScrubLayer`). `variant`: `page` — страница маршрута, `compact` —
 * окно публикации и поле коридора (пропорция `MAP_ASPECT_RATIO`).
 */
export function RouteMap({
  geometry,
  styleUrl,
  label,
  variant,
  scrub,
}: {
  geometry: RouteMapGeometry;
  /** URL стиля из env (`mapStyleUrl`); без него вызывающий показывает `LinePreview` (RC-9) */
  styleUrl: string;
  /** текстовая альтернатива карты */
  label: string;
  variant: 'page' | 'compact';
  scrub?: ScrubStore;
}) {
  const container = useRef<HTMLDivElement>(null);
  const scope = useId();
  const [failed, setFailed] = useState(false);
  const [view] = useState(createMapViewStore);
  const cumulative = useMemo(() => cumulativeMeters(geometry.line), [geometry]);
  const instanceRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  // стор скраббинга и reduce motion — через ref: в зависимостях эффекта создания их нет (иначе пересоздание карты)
  const withScrub = useRef(scrub !== undefined);
  useEffect(() => {
    withScrub.current = scrub !== undefined;
  }, [scrub]);
  const reduced = useReducedMotion();
  const animate = useRef(!reduced);
  useEffect(() => {
    animate.current = !reduced;
  }, [reduced]);

  const [wheelHint, setWheelHint] = useState(false);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = guardWheelZoom(node, () => {
      setWheelHint(true);
      clearTimeout(timer);
      timer = setTimeout(() => setWheelHint(false), WHEEL_HINT_MS);
    });
    return () => {
      release();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    setFailed(false);
    loadMaplibre()
      .then(({ Map }) => {
        if (cancelled) return;
        const created = new Map({
          container: node,
          style: styleUrl,
          ...interactiveMapOptions({ bounds: geometry.bounds, padding: MAP_FIT_PADDING }),
        });
        created.touchZoomRotate.disableRotation();
        created.keyboard.disableRotation();
        instance = created;
        instanceRef.current = created;
        setReady(true);
        collapseAttribution(created, node);
        let loaded = false;
        created.on('load', () => {
          loaded = true;
          created.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: routeFeatures(geometry) });
          const layers = routeLayers(PANEL_MAP_THEME, 0, geometry.bounds, ROUTE_CATALOG_LINE_WIDTH);
          for (const layer of layers) {
            if (layer.id !== CORRIDOR_LAYER_ID) created.addLayer(layer);
          }
          if (withScrub.current) {
            const reproject = () =>
              view.setState({
                points: projectLine(geometry.line, (point) => {
                  const { x, y } = created.project(point);
                  return [x, y];
                }),
              });
            reproject();
            for (const event of SCRUB_REPROJECT_EVENTS) created.on(event, reproject);
          }
        });
        // фатальна только ошибка до `load`; ошибка тайла новой области после — MapLibre перезапросит
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
      view.setState({ points: null });
    };
  }, [geometry, styleUrl, view]);

  return (
    <div
      className={`route-map route-map--${variant}`}
      data-testid="route-map"
      // пропорция компактной карты — константа раскладки пакета (не px)
      style={variant === 'compact' ? { aspectRatio: String(MAP_ASPECT_RATIO) } : undefined}
    >
      <style>{attributionCss(scope, PANEL_MAP_THEME, false)}</style>
      <div className="route-map__label" role="img" aria-label={label} />
      <div
        ref={container}
        className="route-map__canvas"
        data-testid="route-map-canvas"
        data-route-map={scope}
      />
      {scrub ? <ScrubLayer view={view} store={scrub} cumulative={cumulative} /> : null}
      {wheelHint ? (
        <div className="route-map__hint" aria-hidden="true">
          <span className="route-map__hint-text t-meta">
            {t(isMacPlatform() ? 'maps.gestures.wheelMac' : 'maps.gestures.wheel')}
          </span>
        </div>
      ) : null}
      {failed ? (
        <div className="route-map__failed">
          <p className="t-meta">{t('routes.detail.map.failed')}</p>
        </div>
      ) : null}
      {ready && !failed ? (
        <MapControls
          onZoomIn={() => instanceRef.current?.zoomIn({ animate: animate.current })}
          onZoomOut={() => instanceRef.current?.zoomOut({ animate: animate.current })}
          onFit={() =>
            instanceRef.current?.fitBounds(geometry.bounds, {
              padding: MAP_FIT_PADDING,
              animate: animate.current,
            })
          }
        />
      ) : null}
    </div>
  );
}
