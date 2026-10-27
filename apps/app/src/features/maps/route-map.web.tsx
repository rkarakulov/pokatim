import 'maplibre-gl/dist/maplibre-gl.css';

import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { cumulativeMeters } from '@pokatim/tracks';
import { textStyle, useReducedMotion } from '@rkarakulov/ui';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { attributionCss, collapseAttribution } from './attribution.web';
import {
  CORRIDOR_LAYER_ID,
  MAP_FIT_PADDING,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
} from './corridor-style';
import { loadMaplibre } from './load-maplibre';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from './map-camera';
import { MapControls } from './map-controls';
import { mapLocale } from './map-locale.web';
import { guardWheelZoom, isMacPlatform, WHEEL_HINT_MS } from './map-wheel.web';
import { createMapViewStore } from './map-view-store';
import { MAP_WORKER_FILE } from './map-worker';
import { RouteMapFrame } from './route-map-frame';
import type { RouteMapProps } from './route-map-props';
import { projectLine } from './scrub-line';
import { ScrubLayer } from './scrub-layer';
import {
  TRACK_BEFORE_LAYER_ID,
  TRACK_SOURCE_ID,
  trackFeatures,
  trackLayers,
  unionBounds,
} from './track-style';

/**
 * Web-карта маршрута (`maplibre-gl` 6, ADR-0014 п. 5): модуль грузится динамическим `import()` только после
 * монтирования — в серверный рендер и первый чанк не попадает (статически — только CSS). Интерактивная (routes-04b;
 * routes-04c — решение пользователя «одним пальцем»): без кооперативного режима — мышь и один палец тащат карту
 * (касание карты страницу не прокручивает, вне карты — прокручивает), два пальца — зум; колесо с Ctrl/⌘ — зум, без
 * модификатора — прокрутка страницы и подсказка (`guardWheelZoom`); двойной клик — приближение; вращение и наклон
 * выключены; зум `MAP_MIN_ZOOM…MAP_MAX_ZOOM`; кнопки «+», «−», «в рамку» (без анимации при reduce motion).
 * Компактная атрибуция — свёрнута при старте и в цветах темы (B2, B4 maps-02), начальная камера — по рамке без анимации с отступом под
 * контролы. Смена стиля (темы) — пересоздание карты. Ошибка до `load` (стиль, первые тайлы) — сообщение поверх
 * карты; ошибки тайлов после `load` — без сообщения (как native). `scrub` (routes-04) — маркер скраббинга оверлеем:
 * пиксели линии — `map.project` после `load` и на `SCRUB_REPROJECT_EVENTS` в стор вида (подписан только
 * `ScrubLayer`); карта на кадр камеры не перерисовывается и не пересоздаётся.
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
  // routes-04 (RC-2): пиксели линии для маркера скраббинга — после `load` и на `SCRUB_REPROJECT_EVENTS`; стор
  // скраббинга читается через ref: в зависимостях эффекта создания карты его нет (иначе пересоздание карты)
  const withScrub = useRef(false);
  useEffect(() => {
    withScrub.current = scrub !== undefined;
  }, [scrub]);
  // routes-04b (RC-4): пиксели — в стор вида, не в состояние `RouteMap` (на `move` — кадр камеры)
  const [view] = useState(createMapViewStore);
  const cumulative = useMemo(() => cumulativeMeters(map.line), [map]);
  // экземпляр карты для кнопок; кнопки — только когда карта создана
  const instanceRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  // reduce motion — через ref: в зависимостях эффекта создания нет; `null` (ответа ещё нет) — как «уменьшить»
  const reduced = useReducedMotion();
  const animate = useRef(false);
  useEffect(() => {
    animate.current = reduced === false;
  }, [reduced]);
  // routes-04c: колесо без Ctrl/⌘ — прокрутка страницы; подсказка на `WHEEL_HINT_MS` после последнего прокручивания
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
      .then(({ Map, getVersion, setWorkerUrl }) => {
        if (cancelled) return;
        setWorkerUrl(`/${MAP_WORKER_FILE}?v=${getVersion()}`);
        const created = new Map({
          container: node,
          style: styleUrl,
          // routes-04c: один палец и мышь двигают карту; колесо без Ctrl/⌘ — странице (`guardWheelZoom`)
          interactive: true,
          cooperativeGestures: false,
          dragPan: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          locale: mapLocale(),
          attributionControl: { compact: true },
          bounds: unionBounds(map.bounds, track?.line),
          fitBoundsOptions: { padding: MAP_FIT_PADDING, animate: false },
        });
        created.touchZoomRotate.disableRotation();
        created.keyboard.disableRotation();
        instance = created;
        instanceRef.current = created;
        setReady(true);
        collapseAttribution(created, node);
        // ревью pass 1 (M2): фатальна только ошибка до `load` (стиль, первые тайлы); ошибка тайла новой области после
        // `load` (сеть на секунду) не гасит живую карту и кнопки — MapLibre перезапросит тайл, как native
        let loaded = false;
        created.on('load', () => {
          loaded = true;
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
            // одна функция пересчёта на любое изменение камеры: `move` приходит и на перетаскивание, и на зум
            const reproject = () =>
              view.setState({
                points: projectLine(map.line, (point) => {
                  const { x, y } = created.project(point);
                  return [x, y];
                }),
              });
            reproject();
            for (const event of SCRUB_REPROJECT_EVENTS) created.on(event, reproject);
          }
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
      // remove() снимает обработчики карты (`move`, `resize`) — стор вида больше не пишется
      instance?.remove();
      instanceRef.current = null;
      setReady(false);
      view.setState({ points: null });
    };
  }, [map, styleUrl, theme, corridor, lineWidth, track, view]);

  const fit = () =>
    instanceRef.current?.fitBounds(unionBounds(map.bounds, track?.line), {
      padding: MAP_FIT_PADDING,
      animate: animate.current,
    });

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
      {scrub ? (
        <ScrubLayer view={view} store={scrub} cumulative={cumulative} theme={theme} />
      ) : null}
      {wheelHint ? (
        <View aria-hidden style={styles.hintArea}>
          <Text
            style={[
              textStyle('meta'),
              styles.hint,
              {
                color: theme.text.primary,
                backgroundColor: theme.surface.raised,
                borderColor: theme.border.subtle,
              },
            ]}
          >
            {t(isMacPlatform() ? 'maps.gestures.wheelMac' : 'maps.gestures.wheel')}
          </Text>
        </View>
      ) : null}
      {ready && !failed ? (
        <MapControls
          theme={theme}
          onZoomIn={() => instanceRef.current?.zoomIn({ animate: animate.current })}
          onZoomOut={() => instanceRef.current?.zoomOut({ animate: animate.current })}
          onFit={fit}
        />
      ) : null}
    </RouteMapFrame>
  );
}

/** События камеры, после которых пиксели линии маркера пересчитываются (`move` — и перетаскивание, и зум). */
const SCRUB_REPROJECT_EVENTS = ['resize', 'move'] as const;

const canvasStyle = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  hintArea: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.s4,
    pointerEvents: 'none',
  },
  hint: { paddingHorizontal: space.s3, paddingVertical: space.s2, borderWidth: stroke.hairline },
});
