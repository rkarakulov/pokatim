/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RouteMapGeometry } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RouteRideRoute from '../app/routes/rides/[routeId]/[rideId]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import { rideDetail, rideTrack, RIDE_ID, ROUTE_ID } from './route-rides-fixtures';

jest.mock('@/lib/api');

const getRide = jest.mocked(api.getRouteRide);
const getTrack = jest.mocked(api.getRouteRideTrack);
const getCatalogMap = jest.mocked(api.getCatalogRouteMap);
const getMyMap = jest.mocked(api.getMyRouteMap);

const NOW = new Date('2026-10-28T09:00:00Z');
const LIGHT = 'https://tiles.example/styles/positron';
const geometry: RouteMapGeometry = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
};
const catalogLabel = 'Карта маршрута: 86 км, старт и финиш отмечены';
const mineLabel = 'Карта моего маршрута: 86 км, старт и финиш отмечены';

const routes = { ...tabRoutes, 'routes/rides/[routeId]/[rideId]': RouteRideRoute };
const open = (mine = false) => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  return renderRouter(routes, {
    initialUrl: `/routes/rides/${ROUTE_ID}/${RIDE_ID}${mine ? '?mine=1' : ''}`,
    wrapper: createQueryWrapper(),
  });
};
const trackSource = () =>
  screen.queryAllByTestId('maplibre-GeoJSONSource').find((node) => node.props.id === 'my-track');
const kinds = () =>
  trackSource()!.props.data.features.map(
    (f: { properties: { kind: string } }) => f.properties.kind,
  );
const notPassedOff = () =>
  rideDetail({ status: 'not_passed', reason: 'off_corridor', elapsedSec: null });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
  process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
  getRide.mockResolvedValue(rideDetail());
  getTrack.mockResolvedValue(rideTrack());
  getCatalogMap.mockResolvedValue(geometry);
  getMyMap.mockResolvedValue(geometry);
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
  delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('карта заезда по маршруту (route-rides-02, A4)', () => {
  it('каталог — геометрия каталога, свой трек на карте, легенда без «пунктира»', async () => {
    await open();
    expect(await screen.findByLabelText(catalogLabel)).toBeOnTheScreen();
    expect(getCatalogMap).toHaveBeenCalledWith(ROUTE_ID);
    expect(getMyMap).not.toHaveBeenCalled();
    expect(getTrack).toHaveBeenCalledWith(liveSession.accessToken, ROUTE_ID, RIDE_ID);
    await waitFor(() => expect(trackSource()).toBeDefined());
    expect(kinds()).toEqual(['segment']);
    expect(screen.getByText('Ваш трек')).toBeOnTheScreen();
    expect(screen.queryByText(/пунктир/)).toBeNull();
  });

  it('свой маршрут (?mine=1) — геометрия «Моего», подпись своей карты', async () => {
    await open(true);
    expect(await screen.findByLabelText(mineLabel)).toBeOnTheScreen();
    expect(getMyMap).toHaveBeenCalledWith(liveSession.accessToken, ROUTE_ID);
    expect(getCatalogMap).not.toHaveBeenCalled();
  });

  it('не пройден со сходом — пунктир в легенде, строки и подпись a11y с текстом трека', async () => {
    getRide.mockResolvedValue(notPassedOff());
    getTrack.mockResolvedValue(rideTrack({ offRuns: [{ from: 1, to: 1.5 }] }));
    await open();
    expect(await screen.findByText('Ваш трек · Вне коридора — пунктир')).toBeOnTheScreen();
    expect(screen.getByText('Где сход — пунктиром на карте')).toBeOnTheScreen();
    expect(
      await screen.findByLabelText(new RegExp(`^${catalogLabel}\\. Ваш трек: .*Где сход`)),
    ).toBeOnTheScreen();
    await waitFor(() => expect(kinds()).toContain('off'));
  });

  it('404 трека — карта маршрута без трека и без строки ошибки', async () => {
    getTrack.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await open();
    expect(await screen.findByLabelText(catalogLabel)).toBeOnTheScreen();
    expect(trackSource()).toBeUndefined();
    expect(screen.queryByTestId('route-ride-track-error')).toBeNull();
    expect(screen.queryByText('Ваш трек')).toBeNull();
  });

  it('ошибка трека — карта маршрута, строка с повтором; повтор приносит трек', async () => {
    getTrack.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await open();
    expect(await screen.findByText('Не удалось загрузить трек')).toBeOnTheScreen();
    expect(await screen.findByLabelText(catalogLabel)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(trackSource()).toBeDefined());
    expect(screen.queryByTestId('route-ride-track-error')).toBeNull();
  });

  it('env стиля не задан — карты и запроса трека нет, текст экрана цел', async () => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
    await open();
    expect(await screen.findByText('2:04:37')).toBeOnTheScreen();
    expect(screen.getByText('Это ваш лучший заезд')).toBeOnTheScreen();
    expect(screen.queryByTestId('maplibre-Map')).toBeNull();
    expect(screen.queryByTestId('route-ride-map-skeleton')).toBeNull();
    expect(getTrack).not.toHaveBeenCalled();
  });
});
