import type { CameraRef } from '@maplibre/maplibre-react-native';
import type { Planar } from '@pokatim/tracks';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';

import {
  cameraAfterGesture,
  MAP_CAMERA_ANIMATION_MS,
  MAP_ZOOM_STEP,
  zoomAround,
  type MapCamera,
  type MapViewSize,
} from './map-camera';

/** testID жестов карты — для `createGestureController` в тестах. */
export const MAP_PAN_TEST_ID = 'map-pan';
export const MAP_PINCH_TEST_ID = 'map-pinch';
export const MAP_DOUBLE_TAP_TEST_ID = 'map-double-tap';

/** Последний вид камеры из событий региона (`ViewState` MapLibre RN; в тестах — частичный). */
export interface MapViewSnapshot {
  center?: readonly [number, number];
  zoom?: number;
  bounds: readonly [west: number, south: number, east: number, north: number];
}

/**
 * Вызов камеры MapLibre RN: до инициализации нативного вида `setStop` бросает, нативный промис может отклониться —
 * жест не должен ронять экран.
 */
export function cameraCall(call: () => unknown): void {
  try {
    void Promise.resolve(call()).catch(() => undefined);
  } catch {
    // карта ещё не готова — жест пропускается
  }
}

function cameraOf(view: MapViewSnapshot | null): MapCamera | null {
  if (!view?.center || view.zoom === undefined) return null;
  return { center: [view.center[0], view.center[1]], zoom: view.zoom };
}

/**
 * Жесты карты двумя пальцами (native, routes-04b, RC-2, RC-3): нативные жесты MapLibre выключены (один палец
 * забирал бы прокрутку страницы), карту ведёт RNGH поверх неё — пан двумя пальцами и щипок одновременно, камера —
 * императивно `jumpTo` на кадр (без ре-рендера `RouteMap`): точка под пальцами остаётся под ними, зум ограничен.
 * Двойной тап — приближение вокруг точки (без анимации при reduce motion). `onActive(true)` — на активации первого
 * из пана и щипка (не `onBegin`: он приходит и для одного пальца), `onActive(false)` — после последнего активного.
 * Конфиги — из `useMemo` по стабильным ref (не литералы: иначе перенастройка обработчиков в натив на рендер, M1).
 */
export function useMapGestures({
  camera,
  view,
  size,
  reduceMotion,
  onActive,
}: {
  camera: RefObject<CameraRef | null>;
  view: RefObject<MapViewSnapshot | null>;
  size: RefObject<MapViewSize | null>;
  reduceMotion: boolean;
  onActive: (active: boolean) => void;
}) {
  // общее состояние пана и щипка одного жеста: камера и точка под пальцами на старте, смещение и масштаб
  const gesture = useRef({
    active: 0,
    start: null as MapCamera | null,
    focal0: [0, 0] as Planar,
    translation: [0, 0] as Planar,
    // смещение пана в момент его активации, если щипок уже шёл (ревью pass 1, L1): `focal0` — фокус щипка, путь
    // пальцев до активации пана в нём уже учтён — без базы он вошёл бы дважды (рывок на порог пана)
    translationBase: [0, 0] as Planar,
    scale: 1,
  });

  const configs = useMemo(() => {
    const state = gesture.current;
    const activate = (focal0: Planar) => {
      state.active += 1;
      if (state.active > 1) return;
      state.start = cameraOf(view.current);
      state.focal0 = focal0;
      state.translation = [0, 0];
      state.translationBase = [0, 0];
      state.scale = 1;
      onActive(true);
    };
    const deactivate = () => {
      if (state.active === 0) return;
      state.active -= 1;
      if (state.active > 0) return;
      state.start = null;
      onActive(false);
    };
    const setTranslation = (event: { translationX: number; translationY: number }) => {
      state.translation = [
        event.translationX - state.translationBase[0],
        event.translationY - state.translationBase[1],
      ];
    };
    const apply = () => {
      const viewSize = size.current;
      if (!state.start || !viewSize) return;
      const next = cameraAfterGesture(state.start, viewSize, {
        focal0: state.focal0,
        focal: [state.focal0[0] + state.translation[0], state.focal0[1] + state.translation[1]],
        scale: state.scale,
      });
      cameraCall(() => camera.current?.jumpTo(next));
    };
    return {
      pan: {
        testID: MAP_PAN_TEST_ID,
        runOnJS: true,
        minPointers: 2,
        maxPointers: 2,
        averageTouches: true,
        onActivate: (event: {
          x: number;
          y: number;
          translationX: number;
          translationY: number;
        }) => {
          activate([event.x - event.translationX, event.y - event.translationY]);
          // пан — второй (щипок уже активен): смещение отсчитывается от этого момента
          if (state.active > 1) state.translationBase = [event.translationX, event.translationY];
          setTranslation(event);
          apply();
        },
        onUpdate: (event: { translationX: number; translationY: number }) => {
          setTranslation(event);
          apply();
        },
        onDeactivate: deactivate,
      },
      pinch: {
        testID: MAP_PINCH_TEST_ID,
        runOnJS: true,
        onActivate: (event: { focalX: number; focalY: number; scale: number }) => {
          activate([event.focalX, event.focalY]);
          state.scale = event.scale;
          apply();
        },
        onUpdate: (event: { scale: number }) => {
          state.scale = event.scale;
          apply();
        },
        onDeactivate: deactivate,
      },
      doubleTap: {
        testID: MAP_DOUBLE_TAP_TEST_ID,
        runOnJS: true,
        numberOfTaps: 2,
        onActivate: (event: { x: number; y: number }) => {
          const start = cameraOf(view.current);
          const viewSize = size.current;
          if (!start || !viewSize) return;
          const next = zoomAround(start, viewSize, [event.x, event.y], MAP_ZOOM_STEP);
          cameraCall(() =>
            camera.current?.easeTo({
              ...next,
              duration: reduceMotion ? 0 : MAP_CAMERA_ANIMATION_MS,
              easing: 'ease',
            }),
          );
        },
      },
    };
  }, [camera, view, size, reduceMotion, onActive]);

  // карта ушла посреди жеста (смена темы, рамки) — экран не остаётся без прокрутки
  useEffect(
    () => () => {
      if (gesture.current.active > 0) {
        gesture.current.active = 0;
        onActive(false);
      }
    },
    [onActive],
  );

  const pan = usePanGesture(configs.pan);
  const pinch = usePinchGesture(configs.pinch);
  const doubleTap = useTapGesture(configs.doubleTap);
  return useSimultaneousGestures(pan, pinch, doubleTap);
}
