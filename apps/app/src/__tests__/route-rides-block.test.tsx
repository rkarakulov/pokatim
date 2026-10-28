/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CatalogRouteDetail, MyRoute, RouteMapGeometry } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import CatalogRouteRoute from '../app/routes/[id]';
import MyRouteRoute from '../app/routes/mine/[id]';
import RouteRideRoute from '../app/routes/rides/[routeId]/[rideId]';
import RouteRidePickRoute from '../app/routes/pick/[routeId]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import { rideCandidates, rideRow, ridesPage, ROUTE_ID } from './route-rides-fixtures';

jest.mock('@/lib/api');

const listRides = jest.mocked(api.listRouteRides);

const NOW = new Date('2026-10-28T09:00:00Z');
const TOKEN = liveSession.accessToken;
const never = () => new Promise<never>(() => undefined);
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

const catalogRoute: CatalogRouteDetail = {
  id: ROUTE_ID,
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 1_240,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  author: { kind: 'team' },
  elevation: null,
  gpxAvailable: false,
};
const myRoute = (overrides: Partial<MyRoute> = {}): MyRoute => ({
  id: ROUTE_ID,
  title: 'Вечерний круг',
  status: 'ready',
  failure: null,
  distanceM: 42_000,
  elevationGainM: 310,
  isLoop: true,
  createdAt: '2026-10-26T21:30:00.000Z',
  publication: null,
  canPublish: false,
  submissionsExhausted: false,
  ...overrides,
});
const geometry: RouteMapGeometry = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
};

const routes = {
  ...tabRoutes,
  'routes/[id]': CatalogRouteRoute,
  'routes/mine/[id]': MyRouteRoute,
  'routes/pick/[routeId]': RouteRidePickRoute,
  'routes/rides/[routeId]/[rideId]': RouteRideRoute,
};
const signIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const openCatalog = () =>
  renderRouter(routes, { initialUrl: `/routes/${ROUTE_ID}`, wrapper: createQueryWrapper() });
const openMine = () =>
  renderRouter(routes, { initialUrl: `/routes/mine/${ROUTE_ID}`, wrapper: createQueryWrapper() });
const pullToRefresh = async (testID: string) => {
  const control = screen.getByTestId(testID).props
    .refreshControl as ReactElement<RefreshControlProps>;
  await act(async () => {
    await control.props.onRefresh?.();
  });
};

const bestRow = rideRow({ isBest: true });
const bestLabel = 'Пройден · Лучший · 2:04:37 · 12 октября, 09:30 · Garmin';
const best = { id: bestRow.id, elapsedSec: 7_477, rideStartedAt: bestRow.activity.startedAt };
const emptyHint = 'Проверьте свой заезд — покажем, пройден ли маршрут и за сколько';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  jest.mocked(api.getCatalogRoute).mockResolvedValue(catalogRoute);
  jest.mocked(api.getCatalogRouteMap).mockResolvedValue(geometry);
  jest.mocked(api.listCatalogRouteRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.getMyRoute).mockResolvedValue(myRoute());
  jest.mocked(api.getMyRouteMap).mockResolvedValue(geometry);
  jest.mocked(api.listRouteRideCandidates).mockResolvedValue(rideCandidates());
  listRides.mockResolvedValue(
    ridesPage(
      [bestRow, rideRow({ status: 'not_passed', reason: 'off_corridor', elapsedSec: null })],
      { passedCount: 1, best },
    ),
  );
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('«Мои заезды» на карточке маршрута каталога (route-rides-02, A2)', () => {
  it('гость — блока нет и запроса нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    await openCatalog();
    expect(await screen.findByTestId('route-chips')).toBeOnTheScreen();
    expect(screen.queryByText('Мои заезды')).toBeNull();
    expect(listRides).not.toHaveBeenCalled();
  });

  it('сессия неизвестна (SSR, восстановление) — блока и скелетона нет, запроса нет', async () => {
    await openCatalog();
    expect(await screen.findByTestId('route-chips')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-rides-skeleton')).toBeNull();
    expect(screen.queryByTestId('route-rides')).toBeNull();
    expect(listRides).not.toHaveBeenCalled();
  });

  it('вошедший: скелетон → в шторке сводка, строки, «Лучший», время, «Проверить свой заезд»', async () => {
    signIn();
    let release: () => void = () => undefined;
    listRides.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () =>
          resolve(
            ridesPage(
              [
                bestRow,
                rideRow({ status: 'not_passed', reason: 'off_corridor', elapsedSec: null }),
              ],
              { passedCount: 1, best },
            ),
          );
      }),
    );
    await openCatalog();
    expect(await screen.findByTestId('route-rides-skeleton')).toBeOnTheScreen();
    await act(async () => release());

    const block = await screen.findByTestId('route-rides');
    expect(within(screen.getByTestId('bottom-sheet')).getByTestId('route-rides')).toBe(block);
    expect(listRides).toHaveBeenCalledWith(TOKEN, ROUTE_ID);
    expect(within(block).getByText('Мои заезды')).toBeOnTheScreen();
    expect(within(block).getByText('Заездов: 2 · лучший 2:04:37')).toBeOnTheScreen();
    expect(within(block).getByRole('link', { name: bestLabel })).toBeOnTheScreen();
    expect(within(block).getByText('Лучший')).toBeOnTheScreen();
    expect(within(block).getByText('2:04:37')).toBeOnTheScreen();
    expect(within(block).getByText('Не пройден')).toBeOnTheScreen();
    expect(within(block).getByRole('button', { name: 'Проверить свой заезд' })).toBeOnTheScreen();
  });

  it('строка ведёт на результат заезда', async () => {
    signIn();
    jest.mocked(api.getRouteRide).mockReturnValue(never());
    const router = await openCatalog();
    await fireEvent.press(await screen.findByRole('link', { name: bestLabel }));
    expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${bestRow.id}`);
  });

  it('больше 5 строк — «Показать все (7)» раскрывает на месте', async () => {
    signIn();
    listRides.mockResolvedValue(ridesPage(Array.from({ length: 7 }, () => rideRow())));
    await openCatalog();
    const block = await screen.findByTestId('route-rides');
    expect(within(block).getAllByRole('link')).toHaveLength(5);
    await fireEvent.press(within(block).getByRole('button', { name: 'Показать все (7)' }));
    expect(within(block).getAllByRole('link')).toHaveLength(7);
    expect(within(block).queryByRole('button', { name: 'Показать все (7)' })).toBeNull();
  });

  it('пусто — подсказка и «Проверить свой заезд» → выбор каталога', async () => {
    signIn();
    listRides.mockResolvedValue(ridesPage());
    const router = await openCatalog();
    expect(await screen.findByText(emptyHint)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Проверить свой заезд' }));
    expect(router.getPathname()).toBe(`/routes/pick/${ROUTE_ID}`);
    expect(router.getSearchParams()).not.toHaveProperty('mine');
  });

  it('404 списка (маршрут стал невидим) — блока нет', async () => {
    signIn();
    listRides.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await openCatalog();
    await waitFor(() => expect(listRides).toHaveBeenCalled());
    expect(await screen.findByTestId('route-chips')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByTestId('route-rides-skeleton')).toBeNull());
    expect(screen.queryByTestId('route-rides')).toBeNull();
  });

  it('ошибка — баннер с повтором; повтор зовёт API и показывает данные', async () => {
    signIn();
    listRides.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openCatalog();
    expect(await screen.findByText('Не удалось загрузить ваши заезды')).toBeOnTheScreen();
    await fireEvent.press(
      within(screen.getByTestId('route-rides')).getByRole('button', { name: 'Повторить' }),
    );
    expect(await screen.findByText('Заездов: 2 · лучший 2:04:37')).toBeOnTheScreen();
    expect(listRides).toHaveBeenCalledTimes(2);
  });

  it('строка queued — опрос раз в 3 с; после passed опрос прекращается', async () => {
    signIn();
    listRides
      .mockResolvedValueOnce(ridesPage([rideRow({ status: 'queued', elapsedSec: null })]))
      .mockResolvedValue(ridesPage([rideRow()]));
    await openCatalog();
    expect(await screen.findByText('В очереди')).toBeOnTheScreen();
    await advance(3000);
    expect(await screen.findByText('Пройден')).toBeOnTheScreen();
    const calls = listRides.mock.calls.length;
    await advance(30_000);
    expect(listRides).toHaveBeenCalledTimes(calls);
  });

  it('pull-to-refresh карточки перезапрашивает список', async () => {
    signIn();
    await openCatalog();
    expect(await screen.findByTestId('route-rides')).toBeOnTheScreen();
    expect(listRides).toHaveBeenCalledTimes(1);
    await pullToRefresh('route-detail');
    expect(listRides).toHaveBeenCalledTimes(2);
  });
});

describe('«Мои заезды» на карточке своего маршрута', () => {
  it('готовый — блок; «Проверить свой заезд» → выбор с ?mine=1', async () => {
    signIn();
    listRides.mockResolvedValue(ridesPage());
    const router = await openMine();
    expect(await screen.findByText(emptyHint)).toBeOnTheScreen();
    expect(listRides).toHaveBeenCalledWith(TOKEN, ROUTE_ID);
    await fireEvent.press(screen.getByRole('button', { name: 'Проверить свой заезд' }));
    expect(router.getPathname()).toBe(`/routes/pick/${ROUTE_ID}`);
    expect(router.getSearchParams()).toMatchObject({ mine: '1' });
  });

  it('строка своего маршрута ведёт на результат с ?mine=1', async () => {
    signIn();
    jest.mocked(api.getRouteRide).mockReturnValue(never());
    const router = await openMine();
    await fireEvent.press(await screen.findByRole('link', { name: bestLabel }));
    expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${bestRow.id}`);
    expect(router.getSearchParams()).toMatchObject({ mine: '1' });
  });

  it('обрабатывается — блока нет и запроса нет', async () => {
    signIn();
    jest
      .mocked(api.getMyRoute)
      .mockResolvedValue(
        myRoute({ status: 'processing', distanceM: null, elevationGainM: null, isLoop: null }),
      );
    await openMine();
    expect((await screen.findAllByText('Вечерний круг')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Мои заезды')).toBeNull();
    expect(listRides).not.toHaveBeenCalled();
  });

  it('pull-to-refresh карточки перезапрашивает список', async () => {
    signIn();
    await openMine();
    expect(await screen.findByTestId('route-rides')).toBeOnTheScreen();
    await pullToRefresh('my-route-detail');
    expect(listRides).toHaveBeenCalledTimes(2);
  });
});
