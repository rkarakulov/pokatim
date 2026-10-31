/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { CatalogRouteDetail, RaceCard, RouteMapGeometry } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import CatalogRouteRoute from '../app/routes/[id]';
import RouteRideOthersRoute from '../app/routes/others/[routeId]';
import RouteRideRoute from '../app/routes/rides/[routeId]/[rideId]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  leaderboard,
  leaderboardMe,
  leaderboardRow,
  RIDE_ID,
  RIDER_PUBLIC_ID,
  ridesPage,
  ROUTE_ID,
} from './route-rides-fixtures';

jest.mock('@/lib/api');

const getBoard = jest.mocked(api.getRouteRideLeaderboard);

const NOW = new Date('2026-10-28T09:00:00Z');
const TOKEN = liveSession.accessToken;
const never = () => new Promise<never>(() => undefined);
const notFound = () => new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' });
const serverError = () => new ApiHttpError(500, { code: 'INTERNAL', message: 'x' });

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
  exportFormats: [],
};
const geometry: RouteMapGeometry = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
};
const race: RaceCard = {
  id: '0190a6f4-0000-7000-8000-000000000101',
  title: 'Осенний коридор',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 86,
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: null,
};

const routes = {
  ...tabRoutes,
  'routes/[id]': CatalogRouteRoute,
  'routes/rides/[routeId]/[rideId]': RouteRideRoute,
  // цели переходов из строк: проверяется только адрес
  'settings/profile': () => null,
  'riders/[id]': () => null,
  'routes/others/[routeId]': RouteRideOthersRoute,
};
const signIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const openOthers = (id = ROUTE_ID) =>
  renderRouter(routes, { initialUrl: `/routes/others/${id}`, wrapper: createQueryWrapper() });
const openCatalog = () =>
  renderRouter(routes, { initialUrl: `/routes/${ROUTE_ID}`, wrapper: createQueryWrapper() });
const pullToRefresh = async (testID: string) => {
  const control = screen.getByTestId(testID).props
    .refreshControl as ReactElement<RefreshControlProps>;
  await act(async () => {
    await control.props.onRefresh?.();
  });
};
const block = () => screen.findByTestId('route-ride-others');

/** Пять чужих строк: «Анна К.» — публичная, остальные — «Участник». */
const fiveRows = () => [
  leaderboardRow({ place: 1, riderName: 'Анна К.', riderPublicId: RIDER_PUBLIC_ID }),
  ...[2, 3, 4, 5].map((place) => leaderboardRow({ place, elapsedSec: 7_477 + place * 60 })),
];
const annaLink = 'Профиль райдера, Анна К., 1, 2:04:37, 4 октября';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  jest.mocked(api.getCatalogRoute).mockResolvedValue(catalogRoute);
  jest.mocked(api.getCatalogRouteMap).mockResolvedValue(geometry);
  jest.mocked(api.listCatalogRouteRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRouteRides).mockResolvedValue(ridesPage());
  getBoard.mockResolvedValue(leaderboard(fiveRows(), { total: 12 }));
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('«Другие на маршруте» на карточке маршрута каталога (route-rides-04)', () => {
  it('гость — блока и запроса нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    await openCatalog();
    expect(await screen.findByTestId('route-chips')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-ride-others')).toBeNull();
    expect(getBoard).not.toHaveBeenCalled();
  });

  it('сессия неизвестна (SSR) — блока и запроса нет', async () => {
    await openCatalog();
    expect(await screen.findByTestId('route-chips')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-ride-others')).toBeNull();
    expect(getBoard).not.toHaveBeenCalled();
  });

  it('скелетон → 5 строк (место, кто, время, день) и «Все (12)»; запрос limit 5', async () => {
    signIn();
    let release: () => void = () => undefined;
    getBoard.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(leaderboard(fiveRows(), { total: 12 }));
      }),
    );
    await openCatalog();
    expect(await screen.findByTestId('route-ride-others-skeleton')).toBeOnTheScreen();
    await act(async () => release());

    const others = await block();
    expect(await within(others).findByRole('link', { name: annaLink })).toBeOnTheScreen();
    expect(getBoard).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { limit: 5 });
    expect(within(others).getByText('Другие на маршруте')).toBeOnTheScreen();
    expect(within(others).getByText('Анна К.')).toBeOnTheScreen();
    expect(within(others).getAllByText('Участник')).toHaveLength(4);
    expect(within(others).getByLabelText('5, Участник, 2:09:37, 4 октября')).toBeOnTheScreen();
    expect(within(others).getAllByText('4 октября')).toHaveLength(5);
    expect(within(others).getByRole('button', { name: 'Все (12)' })).toBeOnTheScreen();
  });

  it('все строки уже показаны — без «Все (N)»', async () => {
    signIn();
    getBoard.mockResolvedValue(leaderboard(fiveRows()));
    await openCatalog();
    const others = await block();
    await waitFor(() => expect(within(others).getAllByText('Участник')).toHaveLength(4));
    expect(within(others).queryByRole('button', { name: /^Все/ })).toBeNull();
  });

  it('порядок: «Мои заезды» → «Другие на маршруте» → «Гонки на маршруте»', async () => {
    signIn();
    jest.mocked(api.listCatalogRouteRaces).mockResolvedValue({ items: [race], nextCursor: null });
    await openCatalog();
    expect(await screen.findByText('Осенний коридор')).toBeOnTheScreen();
    await block();
    const titles = screen
      .getAllByText(/^(Мои заезды|Другие на маршруте|Гонки на маршруте)$/)
      .map((node) => node.props.children as string);
    expect(titles).toEqual(['Мои заезды', 'Другие на маршруте', 'Гонки на маршруте']);
  });

  it('своя в первых 5 (`rideId`) — «Вы» в списке, без отдельной строки; нажатие — свой заезд', async () => {
    signIn();
    jest.mocked(api.getRouteRide).mockReturnValue(never());
    getBoard.mockResolvedValue(
      leaderboard([leaderboardRow({ place: 1 }), leaderboardRow({ place: 2, rideId: RIDE_ID })], {
        me: leaderboardMe({ place: 2, elapsedSec: 7_477, rideDate: '2026-10-04' }),
      }),
    );
    const router = await openCatalog();
    const others = await block();
    const own = await within(others).findByRole('button', {
      name: 'Ваш заезд, 2, 2:04:37, 4 октября',
    });
    expect(within(others).getAllByText('Вы')).toHaveLength(1);
    await fireEvent.press(own);
    expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`);
  });

  it('своя вне 5 — отдельной строкой со своим местом', async () => {
    signIn();
    getBoard.mockResolvedValue(leaderboard(fiveRows(), { total: 12, me: leaderboardMe() }));
    await openCatalog();
    const others = await block();
    expect(
      await within(others).findByRole('button', { name: 'Ваш заезд, 7, 2:15:00, 12 октября' }),
    ).toBeOnTheScreen();
    expect(within(others).getByText('7')).toBeOnTheScreen();
    expect(within(others).getAllByText('Вы')).toHaveLength(1);
  });

  it('без согласия — «Видно только вам» и «Включить показ» → профиль', async () => {
    signIn();
    getBoard.mockResolvedValue(
      leaderboard([], { total: 1, me: leaderboardMe({ place: 1 }), shared: false }),
    );
    const router = await openCatalog();
    const others = await block();
    expect(await within(others).findByText('Видно только вам')).toBeOnTheScreen();
    expect(
      within(others).queryByText('Пока никто не поделился заездами на этом маршруте'),
    ).toBeNull();
    await fireEvent.press(within(others).getByRole('button', { name: 'Включить показ' }));
    expect(router.getPathname()).toBe('/settings/profile');
  });

  it('с согласием — без «Видно только вам» и «Включить показ»', async () => {
    signIn();
    getBoard.mockResolvedValue(leaderboard(fiveRows(), { me: leaderboardMe() }));
    await openCatalog();
    const others = await block();
    await within(others).findByText('Анна К.');
    expect(within(others).queryByText('Видно только вам')).toBeNull();
    expect(within(others).queryByRole('button', { name: 'Включить показ' })).toBeNull();
  });

  it('пусто — текст', async () => {
    signIn();
    getBoard.mockResolvedValue(leaderboard());
    await openCatalog();
    const others = await block();
    expect(
      await within(others).findByText('Пока никто не поделился заездами на этом маршруте'),
    ).toBeOnTheScreen();
  });

  it('404 (маршрут без длины, стал невидим) — блока нет', async () => {
    signIn();
    getBoard.mockRejectedValue(notFound());
    await openCatalog();
    await waitFor(() => expect(getBoard).toHaveBeenCalled());
    expect(await screen.findByTestId('route-chips')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByTestId('route-ride-others-skeleton')).toBeNull());
    expect(screen.queryByTestId('route-ride-others')).toBeNull();
  });

  it('ошибка — баннер с повтором; повтор перезапрашивает', async () => {
    signIn();
    getBoard.mockRejectedValueOnce(serverError());
    await openCatalog();
    expect(await screen.findByText('Не удалось загрузить таблицу')).toBeOnTheScreen();
    await fireEvent.press(within(await block()).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(getBoard).toHaveBeenCalledTimes(2);
  });

  it('сетевая ошибка — «Нет соединения» с повтором', async () => {
    signIn();
    getBoard.mockRejectedValueOnce(new ApiNetworkError(new Error('offline')));
    await openCatalog();
    const others = await block();
    expect(await within(others).findByText('Нет соединения')).toBeOnTheScreen();
    expect(within(others).getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
  });

  it('пауза без сети — «Нет соединения», не вечный скелетон', async () => {
    signIn();
    let release: () => void = () => undefined;
    jest.mocked(api.getCatalogRoute).mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(catalogRoute);
      }),
    );
    await openCatalog();
    // карточка уже в запросе; таблица стартует после неё — уже без сети
    await act(async () => {
      onlineManager.setOnline(false);
    });
    await act(async () => release());
    const others = await block();
    expect(await within(others).findByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-ride-others-skeleton')).toBeNull();
    expect(getBoard).not.toHaveBeenCalled();
    // сеть вернулась — запрос уходит сам (без повтора), и тест не оставляет висящий запрос следующему
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(await within(others).findByText('Анна К.')).toBeOnTheScreen();
  });

  it('ошибка обновления при строках — строки и «Данные могли устареть» с повтором', async () => {
    signIn();
    await openCatalog();
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    getBoard.mockRejectedValueOnce(serverError());
    await pullToRefresh('route-detail');
    const others = await block();
    expect(await within(others).findByText('Данные могли устареть')).toBeOnTheScreen();
    expect(within(others).getByText('Анна К.')).toBeOnTheScreen();
    await fireEvent.press(within(others).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(within(others).queryByText('Данные могли устареть')).toBeNull());
  });

  it('pull-to-refresh карточки перезапрашивает таблицу', async () => {
    signIn();
    await openCatalog();
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(getBoard).toHaveBeenCalledTimes(1);
    await pullToRefresh('route-detail');
    expect(getBoard).toHaveBeenCalledTimes(2);
  });

  it('публичная строка → профиль райдера; «Участник» не нажимается', async () => {
    signIn();
    const router = await openCatalog();
    const others = await block();
    const participant = await within(others).findByLabelText('2, Участник, 2:06:37, 4 октября');
    expect(participant.props.accessibilityRole).toBeUndefined();
    await fireEvent.press(within(others).getByRole('link', { name: annaLink }));
    expect(router.getPathname()).toBe(`/riders/${RIDER_PUBLIC_ID}`);
  });

  it('«Все (12)» → полный список', async () => {
    signIn();
    const router = await openCatalog();
    await fireEvent.press(await within(await block()).findByRole('button', { name: 'Все (12)' }));
    expect(router.getPathname()).toBe(`/routes/others/${ROUTE_ID}`);
  });
});

describe('полный список «Другие на маршруте» (`/routes/others/<id>`, route-rides-04)', () => {
  const hundred = () =>
    Array.from({ length: 100 }, (_, index) => leaderboardRow({ place: index + 1 }));

  it('гость по прямой ссылке — гард ведёт на лендинг, без запроса', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/routes/others/${ROUTE_ID}` });
    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
    expect(getBoard).not.toHaveBeenCalled();
  });

  it('в полном приложении — экран списка (не карточка маршрута); запрос limit 100', async () => {
    signIn();
    await renderRouter(appRoutes, { initialUrl: `/routes/others/${ROUTE_ID}` });
    expect(await screen.findByRole('header', { name: 'Другие на маршруте' })).toBeOnTheScreen();
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(getBoard).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { limit: 100 });
  });

  it('скелетон → строки; своя вне 100 — отдельно; сноска «Показаны лучшие 100 из 240»', async () => {
    signIn();
    let release: () => void = () => undefined;
    getBoard.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () =>
          resolve(leaderboard(hundred(), { total: 240, me: leaderboardMe({ place: 180 }) }));
      }),
    );
    await openOthers();
    // скелетон `AsyncContent` скрыт от скринридера (`SkeletonGroup`)
    expect(
      await screen.findByTestId('route-ride-others-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    await act(async () => release());
    expect(await screen.findByText('Показаны лучшие 100 из 240')).toBeOnTheScreen();
    expect(screen.getAllByText('Участник')).toHaveLength(100);
    expect(
      screen.getByRole('button', { name: 'Ваш заезд, 180, 2:15:00, 12 октября' }),
    ).toBeOnTheScreen();
  });

  it('все строки показаны — без сноски', async () => {
    signIn();
    getBoard.mockResolvedValue(leaderboard(fiveRows()));
    await openOthers();
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(screen.queryByText(/^Показаны лучшие/)).toBeNull();
  });

  it('невалидный id — «Маршрут недоступен» без запроса; «Все маршруты» → вкладка', async () => {
    signIn();
    const router = await openOthers('not-a-uuid');
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(getBoard).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Все маршруты' }));
    await waitFor(() => expect(router.getPathname()).toBe('/routes'));
  });

  it('404 — «Маршрут недоступен»', async () => {
    signIn();
    getBoard.mockRejectedValue(notFound());
    await openOthers();
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
  });

  it('ошибка — «Не удалось загрузить» с повтором', async () => {
    signIn();
    getBoard.mockRejectedValueOnce(serverError());
    await openOthers();
    await fireEvent.press(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(getBoard).toHaveBeenCalledTimes(2);
  });

  it('pull-to-refresh перезапрашивает', async () => {
    signIn();
    await openOthers();
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    await pullToRefresh('route-ride-others-screen');
    expect(getBoard).toHaveBeenCalledTimes(2);
  });
});
