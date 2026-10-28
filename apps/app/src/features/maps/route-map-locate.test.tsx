/// <reference types="jest" />
import type { RaceRouteMap } from '@pokatim/contracts';
import { space, themes } from '@pokatim/design-tokens';
import { MAP_CAMERA_ANIMATION_MS, MAP_FIT_PADDING } from '@pokatim/route-view';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Linking } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import type * as Position from '@/features/location/current-position';

import { LOCATE_ZOOM, LOCATION_SOURCE_ID } from './location-style';
import { RouteMap } from './route-map';

jest.mock('@/features/location/current-position', () => ({ readCurrentPosition: jest.fn() }));
const readPosition = jest.mocked(
  jest.requireMock<typeof Position>('@/features/location/current-position').readCurrentPosition,
);

interface MapLibreMock {
  __camera: { easeTo: jest.Mock; fitBounds: jest.Mock };
  __map: { showAttribution: jest.Mock };
  Map: (props: object) => ReactNode;
}
const maplibre = jest.requireMock<MapLibreMock>('@maplibre/maplibre-react-native');
const camera = maplibre.__camera;

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
const HERE = [27.56, 53.9] as const;

const reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
beforeEach(() => {
  reduceMotion.mockResolvedValue(false);
  readPosition.mockReset();
  camera.easeTo.mockClear();
  camera.fitBounds.mockClear();
  maplibre.__map.showAttribution.mockClear();
});

async function renderMap(extra: { fill?: boolean; bottomInset?: number } = {}) {
  await render(
    <GestureHandlerRootView>
      <RouteMap
        map={route}
        styleUrl="https://tiles.example/styles/positron"
        theme={themes.light}
        accessibilityLabel="Карта маршрута"
        failedMessage="Карта не загрузилась"
        {...extra}
      />
    </GestureHandlerRootView>,
  );
  const area = await screen.findByTestId('map-area');
  await fireEvent(area, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 700 } },
  });
  return screen.findByTestId('maplibre-Map');
}
const locate = () => screen.getByRole('button', { name: 'Моё местоположение' });
const locationSources = () =>
  screen
    .queryAllByTestId('maplibre-GeoJSONSource')
    .filter((source) => source.props.id === LOCATION_SOURCE_ID);

describe('RouteMap native: «Моё местоположение» (routes-04d, G1, RC-13, RC-14)', () => {
  it('нажатие — одно чтение, камера easeTo на позицию с padding, точка — слоем; RouteMap не перерисовывается', async () => {
    readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
    const original = maplibre.Map;
    const counted = jest.fn(original);
    maplibre.Map = counted;
    try {
      await renderMap();
      expect(locationSources()).toHaveLength(0);
      const before = counted.mock.calls.length;
      await fireEvent.press(locate());
      await act(async () => undefined);
      expect(readPosition).toHaveBeenCalledTimes(1);
      expect(camera.easeTo).toHaveBeenLastCalledWith({
        center: [...HERE],
        zoom: LOCATE_ZOOM,
        padding: MAP_FIT_PADDING,
        duration: MAP_CAMERA_ANIMATION_MS,
        easing: 'ease',
      });
      const [source] = locationSources();
      expect(source!.props.data.features[0].geometry.coordinates).toEqual([...HERE]);
      // точка и ожидание — у листовых компонентов, карта не перерисована
      expect(counted.mock.calls.length).toBe(before);
    } finally {
      maplibre.Map = original;
    }
  });

  it('повторное нажатие во время чтения игнорируется; кнопка занята', async () => {
    let answer: (value: Awaited<ReturnType<typeof readPosition>>) => void = () => undefined;
    readPosition.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await renderMap();
    await fireEvent.press(locate());
    expect(locate()).toBeBusy();
    expect(locate()).toBeDisabled();
    await fireEvent.press(locate());
    expect(readPosition).toHaveBeenCalledTimes(1);
    await act(async () => answer({ status: 'ok', lngLat: HERE }));
    expect(locate()).not.toBeBusy();
    expect(locate()).toBeEnabled();
  });

  it('отказ навсегда — баннер-ссылка в настройки ОС; следующее нажатие скрывает', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    readPosition.mockResolvedValue({ status: 'denied', canOpenSettings: true });
    await renderMap();
    await fireEvent.press(locate());
    const banner = await screen.findByRole('button', {
      name: 'Нет доступа к геопозиции. Нажмите, чтобы открыть настройки.',
    });
    await fireEvent.press(banner);
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(camera.easeTo).not.toHaveBeenCalled();
    readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
    await fireEvent.press(locate());
    await act(async () => undefined);
    expect(screen.queryByTestId('map-locate-notice')).toBeNull();
    openSettings.mockRestore();
  });

  it('отказ с возможностью спросить — текст без ссылки; ошибка — «Не удалось определить местоположение»', async () => {
    readPosition.mockResolvedValue({ status: 'denied', canOpenSettings: false });
    await renderMap();
    await fireEvent.press(locate());
    expect(await screen.findByText('Нет доступа к геопозиции.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Нет доступа/ })).toBeNull();
    readPosition.mockResolvedValue({ status: 'unavailable' });
    await fireEvent.press(locate());
    expect(await screen.findByText('Не удалось определить местоположение.')).toBeOnTheScreen();
  });

  it('reduce motion — камера без анимации', async () => {
    reduceMotion.mockResolvedValue(true);
    readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
    await renderMap();
    await fireEvent.press(locate());
    await act(async () => undefined);
    expect(camera.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 0 }));
  });
});

describe('RouteMap native: fill и шторка (routes-04d, RC-5, RC-6)', () => {
  it('атрибуция «i» — своя кнопка слева внизу, в fill — со сдвигом на высоту шторки; нажатие — диалог MapLibre', async () => {
    const map = await renderMap();
    expect(map.props.attribution).toBe(false);
    const button = () => screen.getByRole('button', { name: 'Об источниках карты' });
    expect(button()).toHaveStyle({ position: 'absolute', bottom: space.s2, left: space.s2 });
    await fireEvent.press(button());
    expect(maplibre.__map.showAttribution).toHaveBeenCalledTimes(1);
    await renderMap({ fill: true, bottomInset: 300 });
    expect(button()).toHaveStyle({ bottom: space.s2 + 300, left: space.s2 });
  });

  it('fill: рамка на всю область; карта монтируется после раскладки — начальная камера и «в рамку» с отступом шторки', async () => {
    await render(
      <GestureHandlerRootView>
        <RouteMap
          map={route}
          styleUrl="https://tiles.example/styles/positron"
          theme={themes.light}
          accessibilityLabel="Карта маршрута"
          failedMessage="Карта не загрузилась"
          fill
          bottomInset={300}
        />
      </GestureHandlerRootView>,
    );
    expect(screen.getByTestId('route-map')).toHaveStyle({ flex: 1 });
    const area = await screen.findByTestId('map-area');
    expect(screen.queryByTestId('maplibre-Map')).toBeNull();
    await fireEvent(area, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 700 } },
    });
    const padding = { ...MAP_FIT_PADDING, bottom: MAP_FIT_PADDING.bottom + 300 };
    expect(screen.getByTestId('maplibre-Camera').props.initialViewState.padding).toEqual(padding);
    await fireEvent.press(screen.getByRole('button', { name: 'Показать маршрут целиком' }));
    expect(camera.fitBounds).toHaveBeenLastCalledWith(route.bounds, {
      padding,
      duration: MAP_CAMERA_ANIMATION_MS,
      easing: 'ease',
    });
  });
});
