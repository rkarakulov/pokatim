import 'maplibre-gl/dist/maplibre-gl.css';

import { space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  attributionPanelCss,
  cameraPadding,
  collapseAttribution,
  CORRIDOR_LAYER_ID,
  createMapViewStore,
  guardWheelZoom,
  interactiveMapOptions,
  isMacPlatform,
  projectLine,
  ROUTE_SOURCE_ID,
  routeFeatures,
  routeLayers,
  WHEEL_HINT_MS,
} from '@pokatim/route-view';
import { cumulativeMeters } from '@pokatim/tracks';
import { textStyle, useReducedMotion } from '@rkarakulov/ui';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { loadMaplibre } from './load-maplibre';
import { LOCATE_ZOOM, LOCATION_SOURCE_ID, locationFeature, locationLayers } from './location-style';
import { MapAttributionButton } from './map-attribution-button';
import { MapOverlayControls } from './map-overlay-controls';
import { MAP_WORKER_FILE } from './map-worker';
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
 * `ScrubLayer`); карта на кадр камеры не перерисовывается и не пересоздаётся. routes-04d: атрибуция — контрол
 * `AttributionControl` в `'bottom-left'` (RC-6) с кнопкой «i» `MapAttributionButton`, над шторкой — сдвиг на
 * `bottomInset`; `fill` — колесо масштабирует без модификатора (RC-7); отступ камеры — `cameraPadding` (высота шторки — через ref, эффект создания карты от неё не
 * зависит); «Моё местоположение» — точка императивно (`addSource`/`setData`), камера — `easeTo` с `offset` (не
 * `padding`: в maplibre-gl он стал бы постоянным `tr.padding` и прибавлялся бы к отступам `fitBounds`).
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
  // своя кнопка «i» раскрывает и сворачивает плашку контрола атрибуции MapLibre
  const toggleAttribution = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  // reduce motion — через ref: в зависимостях эффекта создания нет; `null` (ответа ещё нет) — как «уменьшить»
  const reduced = useReducedMotion();
  const animate = useRef(false);
  useEffect(() => {
    animate.current = reduced === false;
  }, [reduced]);
  // routes-04d: высота шторки — для камеры кнопок и начальной рамки (эффект создания от неё не зависит)
  const inset = useRef(bottomInset);
  useEffect(() => {
    inset.current = bottomInset;
  }, [bottomInset]);
  const padding = () => cameraPadding(inset.current, container.current?.clientHeight || null);
  // routes-04c: колесо без Ctrl/⌘ — прокрутка страницы; подсказка на `WHEEL_HINT_MS` после последнего прокручивания.
  // routes-04d (RC-7): `fill` — страница не прокручивается, колесо масштабирует карту без модификатора
  const [wheelHint, setWheelHint] = useState(false);
  useEffect(() => {
    const node = container.current;
    if (!node || fill) return;
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
  }, [fill]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    setFailed(false);
    loadMaplibre()
      .then(({ Map, AttributionControl, getVersion, setWorkerUrl }) => {
        if (cancelled) return;
        setWorkerUrl(`/${MAP_WORKER_FILE}?v=${getVersion()}`);
        const created = new Map({
          container: node,
          style: styleUrl,
          // routes-04c: один палец и мышь двигают карту; колесо без Ctrl/⌘ — странице (`guardWheelZoom`)
          ...interactiveMapOptions({
            bounds: unionBounds(map.bounds, track?.line),
            padding: cameraPadding(inset.current, node.clientHeight || null),
          }),
          // routes-04d (RC-6): атрибуция — слева внизу (справа — колонка кнопок, снизу — шторка)
          attributionControl: false,
        });
        created.addControl(new AttributionControl({ compact: true }), 'bottom-left');
        created.touchZoomRotate.disableRotation();
        created.keyboard.disableRotation();
        instance = created;
        instanceRef.current = created;
        setReady(true);
        toggleAttribution.current = collapseAttribution(created, node);
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
      padding: padding(),
      animate: animate.current,
    });
  // routes-04d: точка позиции — источник при первой точке, дальше `setData`; до `load` стиля слоя нет — только камера.
  // Пересоздание карты (тема) — точки нет до следующего нажатия
  const showPosition = (lngLat: readonly [number, number]) => {
    const instance = instanceRef.current;
    if (!instance) return;
    const data = locationFeature(lngLat);
    try {
      const source = instance.getSource<GeoJSONSource>(LOCATION_SOURCE_ID);
      if (source) source.setData(data);
      else {
        instance.addSource(LOCATION_SOURCE_ID, { type: 'geojson', data });
        for (const layer of locationLayers(theme)) instance.addLayer(layer);
      }
    } catch {
      // стиль ещё не загружен — точка появится при следующем нажатии
    }
    // центр видимой части над шторкой: смещение вверх на половину её высоты (не `padding` — RC-5)
    instance.easeTo({
      center: [lngLat[0], lngLat[1]],
      zoom: LOCATE_ZOOM,
      offset: [0, -inset.current / 2],
      animate: animate.current,
    });
  };

  return (
    <RouteMapFrame
      theme={theme}
      accessibilityLabel={accessibilityLabel}
      failedMessage={failed ? failedMessage : null}
      fill={fill}
      bottomInset={bottomInset}
    >
      <style>{attributionPanelCss(scope, theme)}</style>
      {bottomInset > 0 ? (
        // атрибуция над шторкой (RC-6): угол контролов maplibre-gl — со сдвигом на её высоту
        <style>{`[data-route-map="${scope}"] .maplibregl-ctrl-bottom-left{bottom:${bottomInset}px}`}</style>
      ) : null}
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
      {ready ? (
        <MapAttributionButton
          theme={theme}
          bottomInset={bottomInset}
          onPress={() => toggleAttribution.current?.()}
        />
      ) : null}
      {ready && !failed ? (
        <MapOverlayControls
          theme={theme}
          onZoomIn={() => instanceRef.current?.zoomIn({ animate: animate.current })}
          onZoomOut={() => instanceRef.current?.zoomOut({ animate: animate.current })}
          onFit={fit}
          onPosition={showPosition}
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
