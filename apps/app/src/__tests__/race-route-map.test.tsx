/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RaceDetail, RaceRouteMap } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { type RefreshControlProps, TurboModuleRegistry, useColorScheme } from 'react-native';

import { centerLat, corridorLineWidth } from '@/features/maps/corridor-style';

import { loadMapLibreNative } from '@/features/maps/load-maplibre-native';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/features/maps/map-camera';
import { api } from '@/lib/api';

import { appRoutes } from './app-routes';
import { actions, noEntry, resultsPage } from './races-fixtures';

jest.mock('@/lib/api');

// jest-пресет React Native подменяет useColorScheme на jest.fn(() => 'light')
const colorScheme = jest.mocked(useColorScheme);
const getRace = jest.mocked(api.getRace);
const getRaceRoute = jest.mocked(api.getRaceRoute);

const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000001';
const LIGHT = 'https://tiles.example/styles/positron';
const DARK = 'https://tiles.example/styles/dark';

const race: RaceDetail = {
  id: ID,
  title: 'Гравийный коридор Логойск',
  bikeClass: 'gravel',
  surfaces: ['gravel'],
  distanceKm: 62,
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: null,
  description: null,
  corridor: { widthM: 50 },
};
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
const heroLabel = 'Гонка · Гравий. Гравийный коридор Логойск. 4–12 октября 2026';
const mapLabel = 'Карта маршрута: 62 км, коридор ±50 м от маршрута, старт и финиш отмечены';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
  process.env.EXPO_PUBLIC_MAP_STYLE_DARK = DARK;
  getRace.mockResolvedValue(race);
  getRaceRoute.mockResolvedValue(route);
  jest
    .mocked(api.getMyRaceEntry)
    .mockResolvedValue(noEntry({ actions: actions({ reasons: ['not_entered'] }) }));
  jest.mocked(api.getRaceResults).mockResolvedValue(resultsPage());
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
  delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  colorScheme.mockReturnValue('light');
  jest.clearAllMocks();
  jest.useRealTimers();
});

async function openCard() {
  await renderRouter(appRoutes, { initialUrl: `/races/${ID}` });
  expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
}

async function pullToRefresh() {
  const control = screen.getByTestId('race-detail').props
    .refreshControl as ReactElement<RefreshControlProps>;
  await act(async () => {
    await control.props.onRefresh?.();
  });
}

describe('карта маршрута на карточке гонки (maps-01)', () => {
  it('коридор и env: карта светлой темы с подписью-альтернативой, камера по рамке без анимации; строки остаются', async () => {
    await openCard();
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    expect(getRaceRoute).toHaveBeenCalledWith(ID);
    const map = await screen.findByTestId('maplibre-Map');
    expect(loadMapLibreNative).toHaveBeenCalled();
    expect(map).toHaveProp('mapStyle', LIGHT);
    expect(map).toHaveProp('attribution', true);
    // routes-04c: один палец двигает карту, щипок — зум (нативные жесты); вращения и наклона нет
    expect(map.props).toMatchObject({
      dragPan: true,
      touchZoom: true,
      touchRotate: false,
      touchPitch: false,
    });
    const camera = screen.getByTestId('maplibre-Camera');
    expect(camera.props.initialViewState).toMatchObject({ bounds: route.bounds });
    // routes-04b (RC-8): зум ограничен; кнопки камеры — сверху справа
    expect(camera.props).toMatchObject({ minZoom: MAP_MIN_ZOOM, maxZoom: MAP_MAX_ZOOM });
    expect(screen.getByRole('button', { name: 'Приблизить' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Показать маршрут целиком' })).toBeOnTheScreen();
    // RC-4: начальная камера не анимируется
    expect(camera.props.duration).toBeUndefined();
    expect(camera.props.animationDuration).toBeUndefined();
    expect(screen.getByTestId('maplibre-GeoJSONSource').props.data.features).toHaveLength(3);
    expect(screen.getAllByTestId('maplibre-Layer').map((layer) => layer.props.id)).toEqual([
      'corridor',
      'route',
      'start',
      'finish',
    ]);
    expect(screen.getByText('Коридор')).toBeOnTheScreen();
    expect(screen.getByText('±50 м от маршрута')).toBeOnTheScreen();
    expect(screen.getByText('62 км по GPS-треку')).toBeOnTheScreen();
  });

  it('тёмная системная тема — тёмный стиль карты', async () => {
    colorScheme.mockReturnValue('dark');
    await openCard();
    expect(await screen.findByTestId('maplibre-Map')).toHaveProp('mapStyle', DARK);
  });

  it('ошибка загрузки стиля — «Карта не загрузилась», карточка цела', async () => {
    await openCard();
    const map = await screen.findByTestId('maplibre-Map');
    await act(async () => fireEvent(map, 'didFailLoadingMap'));
    expect(screen.getByText('Карта не загрузилась')).toBeOnTheScreen();
    expect(screen.getByText('Коридор')).toBeOnTheScreen();
  });

  it('геометрия 404 — блока нет, строки коридора и дистанции остаются', async () => {
    getRaceRoute.mockRejectedValue(
      new ApiHttpError(404, { code: 'NOT_FOUND', message: 'Не найдено' }),
    );
    await openCard();
    await act(async () => {
      await jest.runOnlyPendingTimersAsync();
    });
    expect(getRaceRoute).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(mapLabel)).toBeNull();
    expect(screen.queryByTestId('maplibre-Map')).toBeNull();
    expect(screen.getByText('±50 м от маршрута')).toBeOnTheScreen();
    expect(screen.getByText('62 км по GPS-треку')).toBeOnTheScreen();
  });

  it('env не задан — запроса нет, блока нет', async () => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    await openCard();
    expect(getRaceRoute).not.toHaveBeenCalled();
    expect(screen.queryByTestId('maplibre-Map')).toBeNull();
    expect(screen.getByText('Коридор')).toBeOnTheScreen();
  });

  it('нет нативного модуля MapLibre (Expo Go, старый dev-клиент) — пакет не загружается, блока нет, карточка цела', async () => {
    jest.mocked(TurboModuleRegistry.get).mockReturnValue(null);
    await openCard();
    expect(TurboModuleRegistry.get).toHaveBeenCalledWith('MLRNCameraModule');
    expect(loadMapLibreNative).not.toHaveBeenCalled();
    expect(getRaceRoute).not.toHaveBeenCalled();
    expect(screen.queryByTestId('route-map')).toBeNull();
    expect(screen.getByText('±50 м от маршрута')).toBeOnTheScreen();
    expect(screen.getByText('62 км по GPS-треку')).toBeOnTheScreen();
  });

  it('ошибка обновления при показанной карте — карта остаётся (§4.12); pull-to-refresh перезапрашивает карту', async () => {
    await openCard();
    await screen.findByTestId('maplibre-Map');
    getRaceRoute.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await pullToRefresh();
    // 5xx повторяется (`shouldRetry`): дождаться исчерпания повторов — запрос в состоянии ошибки с данными
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(getRaceRoute).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId('maplibre-Map')).toBeOnTheScreen();
    expect(screen.getByLabelText(mapLabel)).toBeOnTheScreen();
  });

  it('допуск коридора изменили — после pull-to-refresh карта рисует ширину из карточки', async () => {
    await openCard();
    await screen.findByTestId('maplibre-Map');
    getRace.mockResolvedValue({ ...race, corridor: { widthM: 100 } });
    await pullToRefresh();
    expect(
      await screen.findByLabelText(
        'Карта маршрута: 62 км, коридор ±100 м от маршрута, старт и финиш отмечены',
      ),
    ).toBeOnTheScreen();
    const [corridor] = screen.getAllByTestId('maplibre-Layer');
    expect(corridor?.props.paint['line-width']).toEqual(
      corridorLineWidth(100, centerLat(route.bounds)),
    );
  });

  it('маршрут коридора сменили — после pull-to-refresh новая карта с камерой по новой рамке', async () => {
    await openCard();
    await screen.findByTestId('maplibre-Camera');
    expect(loadMapLibreNative).toHaveBeenCalledTimes(1);
    const moved: RaceRouteMap = {
      ...route,
      line: [
        [28.0, 54.2],
        [28.1, 54.3],
      ],
      start: [28.0, 54.2],
      finish: [28.1, 54.3],
      bounds: [28.0, 54.2, 28.1, 54.3],
    };
    getRaceRoute.mockResolvedValue(moved);
    await pullToRefresh();
    await waitFor(() =>
      expect(screen.getByTestId('maplibre-Camera').props.initialViewState).toMatchObject({
        bounds: moved.bounds,
      }),
    );
    // native-камера берёт `initialViewState` один раз — карта перемонтирована (загрузчик вызван заново)
    expect(loadMapLibreNative).toHaveBeenCalledTimes(2);
  });

  it('без коридора — запроса нет, блока нет', async () => {
    getRace.mockResolvedValue({ ...race, corridor: null });
    await openCard();
    expect(getRaceRoute).not.toHaveBeenCalled();
    expect(screen.queryByTestId('maplibre-Map')).toBeNull();
  });

  it('routes-04c: карту двигает один палец нативно — прокрутка карточки не выключается (вне карты — страница)', async () => {
    await openCard();
    const map = await screen.findByTestId('maplibre-Map');
    const scroll = () => screen.getByTestId('race-detail');
    expect(map).toHaveProp('dragPan', true);
    expect(scroll().props.scrollEnabled).not.toBe(false);
    // нативный жест карты двигает камеру — экран прокрутку не трогает
    await fireEvent(map, 'regionIsChanging', {
      nativeEvent: { center: [27.6, 53.9], zoom: 12, bounds: [27.5, 53.8, 27.7, 54.0] },
    });
    expect(scroll().props.scrollEnabled).not.toBe(false);
  });
});
