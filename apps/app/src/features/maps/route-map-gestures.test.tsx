/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { MAP_FIT_PADDING } from './corridor-style';
import {
  cameraAfterGesture,
  MAP_CAMERA_ANIMATION_MS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  zoomAround,
} from './map-camera';
import { MapGestureLockContext } from './map-gesture-lock';
import { MAP_DOUBLE_TAP_TEST_ID, MAP_PAN_TEST_ID, MAP_PINCH_TEST_ID } from './map-gestures';
import { RouteMap } from './route-map';

interface CameraMock {
  jumpTo: jest.Mock;
  easeTo: jest.Mock;
  zoomTo: jest.Mock;
  fitBounds: jest.Mock;
}
const camera = jest.requireMock<{ __camera: CameraMock }>(
  '@maplibre/maplibre-react-native',
).__camera;

const route: RaceRouteMap = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
  widthM: 50,
};
const VIEW = { width: 300, height: 200 };
const START = { center: [27.55, 53.9] as [number, number], zoom: 11 };

const reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
beforeEach(() => {
  reduceMotion.mockResolvedValue(false);
  for (const fn of Object.values(camera)) fn.mockClear();
});

async function renderMap(onMapGesture = jest.fn()) {
  await render(
    <GestureHandlerRootView>
      <MapGestureLockContext value={onMapGesture}>
        <RouteMap
          map={route}
          styleUrl="https://tiles.example/styles/positron"
          theme={themes.light}
          accessibilityLabel="Карта маршрута"
          failedMessage="Карта не загрузилась"
        />
      </MapGestureLockContext>
    </GestureHandlerRootView>,
  );
  const map = await screen.findByTestId('maplibre-Map');
  // вид камеры — из событий региона, размер — раскладка области жестов
  await fireEvent(map, 'regionDidChange', {
    nativeEvent: { ...START, bounds: [27.4, 53.8, 27.7, 54.0] },
  });
  await fireEvent(screen.getByTestId('map-gesture-area'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, ...VIEW } },
  });
  return onMapGesture;
}

describe('RouteMap native: жесты двумя пальцами (routes-04b, RC-2, RC-3)', () => {
  it('нативные жесты карты выключены, зум камеры ограничен 4–17', async () => {
    await renderMap();
    const map = screen.getByTestId('maplibre-Map');
    for (const gesture of ['dragPan', 'touchZoom', 'doubleTapZoom', 'touchRotate', 'touchPitch']) {
      expect(map.props[gesture]).toBe(false);
    }
    expect(screen.getByTestId('maplibre-Camera').props).toMatchObject({
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
    });
  });

  it('пан двумя пальцами — jumpTo: точка под пальцами едет за ними; блокировка прокрутки на время жеста', async () => {
    const lock = await renderMap();
    const pan = createGestureController(MAP_PAN_TEST_ID);
    await act(async () => pan.begin({ x: 100, y: 80, translationX: 0, translationY: 0 }));
    expect(lock).not.toHaveBeenCalled();
    await act(async () => pan.activate({ x: 110, y: 80, translationX: 10, translationY: 0 }));
    expect(lock).toHaveBeenLastCalledWith(true);
    await act(async () => pan.update({ x: 160, y: 50, translationX: 60, translationY: -30 }));
    expect(camera.jumpTo).toHaveBeenLastCalledWith(
      cameraAfterGesture(START, VIEW, { focal0: [100, 80], focal: [160, 50], scale: 1 }),
    );
    await act(async () => pan.end({ x: 160, y: 50, translationX: 60, translationY: -30 }));
    expect(lock.mock.calls).toEqual([[true], [false]]);
  });

  it('пан и щипок одновременно: зум вокруг пальцев; блокировка — одна на жест (счётчик активных)', async () => {
    const lock = await renderMap();
    const pinch = createGestureController(MAP_PINCH_TEST_ID);
    const pan = createGestureController(MAP_PAN_TEST_ID);
    await act(async () => pinch.begin({ focalX: 150, focalY: 100, scale: 1 }));
    await act(async () => pinch.activate({ focalX: 150, focalY: 100, scale: 1.1 }));
    await act(async () => pan.begin({ x: 150, y: 100, translationX: 0, translationY: 0 }));
    await act(async () => pan.activate({ x: 150, y: 100, translationX: 0, translationY: 0 }));
    expect(lock.mock.calls).toEqual([[true]]);
    await act(async () => pinch.update({ focalX: 170, focalY: 110, scale: 2 }));
    await act(async () => pan.update({ x: 170, y: 110, translationX: 20, translationY: 10 }));
    expect(camera.jumpTo).toHaveBeenLastCalledWith(
      cameraAfterGesture(START, VIEW, { focal0: [150, 100], focal: [170, 110], scale: 2 }),
    );
    await act(async () => pan.end({ x: 170, y: 110, translationX: 20, translationY: 10 }));
    expect(lock.mock.calls).toEqual([[true]]);
    await act(async () => pinch.end({ focalX: 170, focalY: 110, scale: 2 }));
    expect(lock.mock.calls).toEqual([[true], [false]]);
  });

  it('один палец (пан не активирован) — камера не двигается, прокрутка не блокируется', async () => {
    const lock = await renderMap();
    const pan = createGestureController(MAP_PAN_TEST_ID);
    await act(async () => pan.begin({ x: 100, y: 80, translationX: 0, translationY: 0 }));
    await act(async () => pan.fail({ x: 100, y: 140, translationX: 0, translationY: 60 }));
    expect(camera.jumpTo).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });

  it('двойной тап — приближение вокруг точки с анимацией; reduce motion — без анимации', async () => {
    await renderMap();
    const tap = createGestureController(MAP_DOUBLE_TAP_TEST_ID);
    await act(async () => tap.begin({ x: 220, y: 60 }));
    await act(async () => tap.activate({ x: 220, y: 60 }));
    await act(async () => tap.end({ x: 220, y: 60 }));
    expect(camera.easeTo).toHaveBeenLastCalledWith({
      ...zoomAround(START, VIEW, [220, 60], 1),
      duration: MAP_CAMERA_ANIMATION_MS,
      easing: 'ease',
    });
  });

  it('reduce motion: двойной тап и кнопки — duration 0', async () => {
    reduceMotion.mockResolvedValue(true);
    await renderMap();
    const tap = createGestureController(MAP_DOUBLE_TAP_TEST_ID);
    await act(async () => tap.begin({ x: 220, y: 60 }));
    await act(async () => tap.activate({ x: 220, y: 60 }));
    expect(camera.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 0 }));
    await fireEvent.press(screen.getByTestId('map-zoom-in'));
    expect(camera.zoomTo).toHaveBeenLastCalledWith(12, { duration: 0, easing: 'ease' });
    await fireEvent.press(screen.getByTestId('map-fit'));
    expect(camera.fitBounds).toHaveBeenLastCalledWith(route.bounds, {
      padding: MAP_FIT_PADDING,
      duration: 0,
      easing: 'ease',
    });
  });
});

describe('RouteMap native: кнопки камеры (routes-04b, RC-5…RC-9)', () => {
  it('«+», «−» — zoomTo на шаг в пределах зума, «в рамку» — fitBounds с явной длительностью', async () => {
    await renderMap();
    await fireEvent.press(screen.getByRole('button', { name: 'Приблизить' }));
    expect(camera.zoomTo).toHaveBeenLastCalledWith(12, {
      duration: MAP_CAMERA_ANIMATION_MS,
      easing: 'ease',
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Отдалить' }));
    expect(camera.zoomTo).toHaveBeenLastCalledWith(10, {
      duration: MAP_CAMERA_ANIMATION_MS,
      easing: 'ease',
    });
    await fireEvent(screen.getByTestId('maplibre-Map'), 'regionDidChange', {
      nativeEvent: { center: START.center, zoom: 16.6, bounds: [27.54, 53.89, 27.56, 53.91] },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Приблизить' }));
    expect(camera.zoomTo).toHaveBeenLastCalledWith(MAP_MAX_ZOOM, expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Показать маршрут целиком' }));
    expect(camera.fitBounds).toHaveBeenLastCalledWith(route.bounds, {
      padding: MAP_FIT_PADDING,
      duration: MAP_CAMERA_ANIMATION_MS,
      easing: 'ease',
    });
  });

  it('ошибка загрузки стиля — кнопок нет', async () => {
    await renderMap();
    expect(screen.getByTestId('map-controls')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('maplibre-Map'), 'didFailLoadingMap');
    expect(screen.queryByTestId('map-controls')).toBeNull();
  });

  it('карта не готова (setStop бросает) — нажатие не роняет экран', async () => {
    camera.zoomTo.mockImplementationOnce(() => {
      throw new Error('NativeCameraComponent ref is null');
    });
    await renderMap();
    await fireEvent.press(screen.getByTestId('map-zoom-in'));
    expect(screen.getByTestId('map-controls')).toBeOnTheScreen();
  });
});
