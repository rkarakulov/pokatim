/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { themes } from '@pokatim/design-tokens';
import {
  MAP_CAMERA_ANIMATION_MS,
  MAP_FIT_PADDING,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from '@pokatim/route-view';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RouteMap } from './route-map';

interface CameraMock {
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

async function renderMap() {
  await render(
    <GestureHandlerRootView>
      <RouteMap
        map={route}
        styleUrl="https://tiles.example/styles/positron"
        theme={themes.light}
        accessibilityLabel="Карта маршрута"
        failedMessage="Карта не загрузилась"
      />
    </GestureHandlerRootView>,
  );
  const map = await screen.findByTestId('maplibre-Map');
  // вид камеры — из событий региона (их шлют и нативные жесты карты), размер — раскладка области карты
  await fireEvent(map, 'regionDidChange', {
    nativeEvent: { ...START, bounds: [27.4, 53.8, 27.7, 54.0] },
  });
  await fireEvent(screen.getByTestId('map-area'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, ...VIEW } },
  });
}

describe('RouteMap native: нативные жесты одним пальцем (routes-04c)', () => {
  it('перетаскивание одним пальцем и щипок — нативные жесты MapLibre; вращение и наклон выключены; зум 2–17', async () => {
    await renderMap();
    const map = screen.getByTestId('maplibre-Map');
    expect(map.props).toMatchObject({
      dragPan: true,
      touchZoom: true,
      doubleTapZoom: true,
      doubleTapHoldZoom: false,
      touchRotate: false,
      touchPitch: false,
    });
    expect(screen.getByTestId('maplibre-Camera').props).toMatchObject({
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
    });
  });

  it('карта без RNGH-оверлея жестов: касание идёт нативной карте', async () => {
    await renderMap();
    expect(screen.queryByTestId('map-gesture-area')).toBeNull();
    expect(screen.getByTestId('map-area')).toContainElement(screen.getByTestId('maplibre-Map'));
  });

  it('жест карты двигает камеру (regionIsChanging) — кнопки зумят от новой камеры', async () => {
    await renderMap();
    await fireEvent(screen.getByTestId('maplibre-Map'), 'regionIsChanging', {
      nativeEvent: { center: [27.6, 53.95], zoom: 14, bounds: [27.58, 53.94, 27.62, 53.96] },
    });
    await fireEvent.press(screen.getByTestId('map-zoom-in'));
    expect(camera.zoomTo).toHaveBeenLastCalledWith(15, expect.anything());
  });

  it('reduce motion: двойной тап (анимация нативной карты) выключен, кнопки — duration 0', async () => {
    reduceMotion.mockResolvedValue(true);
    await renderMap();
    expect(screen.getByTestId('maplibre-Map').props).toMatchObject({
      dragPan: true,
      touchZoom: true,
      doubleTapZoom: false,
    });
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
