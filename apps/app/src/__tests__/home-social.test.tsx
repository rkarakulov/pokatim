/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type {
  CatalogRouteCard,
  ProfileView,
  RideCard,
  SocialHome,
  SocialHomeRideRow,
} from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);
const getSocialHome = jest.mocked(api.getSocialHome);
const joinRide = jest.mocked(api.joinRide);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const PUBLIC_ID = 'k'.repeat(43);
const RIDE_ID = '0190a6f4-0000-7000-8000-000000000103';
const RACE_ID = '0190a6f4-0000-7000-8000-000000000101';
const ENTRY_ID = '0190a6f4-0000-7000-8000-000000000102';
const ROUTE_ID = '0190a6f4-0000-7000-8000-000000000104';
const SECTION = 'Что у своих';
const HINT = 'Добавьте имя — свои увидят вас';

const rider = (name: string) => ({ name, publicId: PUBLIC_ID, avatar: null });

const ride: RideCard = {
  id: RIDE_ID,
  title: 'Кофе-райд на Минское море',
  organizerName: null,
  startsAt: '2026-10-03T06:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 5,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  route: null,
  start: null,
  photo: null,
  viewer: {
    role: 'none',
    canJoin: true,
    canLeave: false,
    canManage: false,
    reported: false,
    canReport: false,
  },
};

const route: CatalogRouteCard = {
  id: ROUTE_ID,
  title: 'Вокруг моря',
  distanceM: 42_000,
  elevationGainM: 120,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-09-30T10:00:00.000Z',
  author: { kind: 'rider', name: 'Сергей К.' },
};

const rideRow: SocialHomeRideRow = {
  kind: 'ride',
  ride,
  riders: [rider('Катя Л.'), rider('Ева')],
  othersCount: 1,
};
const home: SocialHome = {
  items: [
    rideRow,
    {
      kind: 'result',
      rider: rider('Андрей К.'),
      race: { id: RACE_ID, title: 'Гран-при' },
      entryId: ENTRY_ID,
      place: 2,
      tied: false,
      elapsedSec: 7180,
      deltaSec: -80,
    },
    { kind: 'route', rider: rider('Сергей К.'), route },
  ],
};

const profileOf = (rideReasons: ProfileView['rideReasons'], publicId: string | null = null) =>
  getProfile.mockResolvedValue({
    rideReasons,
    publicName: publicId ? 'Зритель' : null,
    showNameInResults: publicId !== null,
    club: null,
    avatar: null,
    publicId,
    themeId: 'classic',
    avatarUploadBlockedUntil: null,
    showRouteRides: false,
  });

const routes = {
  ...tabRoutes,
  'rides/[id]': () => null,
  'races/result/[id]/[entryId]': () => null,
  'routes/[id]': () => null,
};
const openHome = () => renderRouter(routes, { initialUrl: '/', wrapper: createQueryWrapper() });

/** Заголовки разделов, секции и подсказки в порядке ленты. */
const TITLES = new Set([
  'Ближайшие гонки',
  'Ближайшие кофе-райды',
  'Маршруты команды',
  'Ближайшие старты',
  SECTION,
  HINT,
]);
const feedOrder = () => {
  const order: string[] = [];
  const walk = (node: ReturnType<typeof screen.getByTestId> | string) => {
    if (typeof node === 'string') {
      if (TITLES.has(node)) order.push(node);
      return;
    }
    node.children.forEach(walk);
  };
  walk(screen.getByTestId('home-feed'));
  return order.filter((title, index) => order.indexOf(title) === index);
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  profileOf([]);
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRides).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCatalogRoutes).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listTickets).mockResolvedValue({ upcoming: [], past: [] });
  getSocialHome.mockResolvedValue(home);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('Главная: секция «Свои» (K7, social-p7)', () => {
  it('«Кофе-райды» в опросе — секция первой, подсказка K3 под ней в том же слоте', async () => {
    profileOf(['group_rides']);
    await openHome();
    expect(await screen.findByText(SECTION)).toBeOnTheScreen();
    expect(await screen.findByText(HINT)).toBeOnTheScreen();
    expect(feedOrder()).toEqual([
      SECTION,
      HINT,
      'Ближайшие кофе-райды',
      'Ближайшие гонки',
      'Маршруты команды',
      'Ближайшие старты',
    ]);
    expect(getSocialHome).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it('без «Кофе-райдов» — после выбранных разделов; публичному — без подсказки', async () => {
    profileOf(['races'], 'p'.repeat(43));
    await openHome();
    expect(await screen.findByText(SECTION)).toBeOnTheScreen();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(feedOrder()).toEqual([
      'Ближайшие гонки',
      SECTION,
      'Ближайшие кофе-райды',
      'Маршруты команды',
      'Ближайшие старты',
    ]);
  });

  it('строки: «идут», результат с разницей, новый маршрут', async () => {
    await openHome();
    expect(await screen.findByText('Катя Л. и ещё 2 идут')).toBeOnTheScreen();
    expect(screen.getByText('Андрей К. · 1:59:40')).toBeOnTheScreen();
    expect(screen.getByText('Гран-при · 2')).toBeOnTheScreen();
    expect(screen.getByText('на 1:20 быстрее вас')).toBeOnTheScreen();
    expect(screen.getByText('Новый маршрут от Сергей К.')).toBeOnTheScreen();
    // подпись диктора — время, а не вся строка с именем
    expect(
      screen.getByRole('link', {
        name: 'Андрей К., Гран-при: место 2, время 1:59:40. на 1:20 быстрее вас',
      }),
    ).toBeOnTheScreen();
  });

  it.each([
    [
      'райд',
      () => screen.getByRole('link', { name: /Кофе-райд на Минское море/ }),
      `/rides/${RIDE_ID}`,
    ],
    [
      'результат',
      () => screen.getByRole('link', { name: /Андрей К\., Гран-при/ }),
      `/races/result/${RACE_ID}/${ENTRY_ID}`,
    ],
    ['маршрут', () => screen.getByRole('link', { name: /Вокруг моря/ }), `/routes/${ROUTE_ID}`],
  ])('строка «%s» ведёт на объект', async (_name, link, path) => {
    const router = await openHome();
    await screen.findByText(SECTION);
    await fireEvent.press(link());
    await waitFor(() => expect(router.getPathname()).toBe(path));
  });

  it('«Я иду» — joinRide с источником social_home, затем секция перезапрашивается', async () => {
    joinRide.mockResolvedValue({
      ride: { ...ride, goingCount: 6 },
      viewer: { ...ride.viewer, role: 'participant', canJoin: false, canLeave: true },
    } as never);
    await openHome();
    await screen.findByText(SECTION);
    expect(getSocialHome).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Я иду' }));
    await waitFor(() =>
      expect(joinRide).toHaveBeenCalledWith(liveSession.accessToken, RIDE_ID, 'social_home'),
    );
    await waitFor(() => expect(getSocialHome).toHaveBeenCalledTimes(2));
  });

  it('«Все свои» → /social', async () => {
    const router = await renderRouter(
      { ...routes, social: () => null },
      { initialUrl: '/', wrapper: createQueryWrapper() },
    );
    await screen.findByText(SECTION);
    await fireEvent.press(screen.getByRole('button', { name: 'Все свои' }));
    await waitFor(() => expect(router.getPathname()).toBe('/social'));
  });

  it.each([
    [
      'ошибка запроса',
      () =>
        getSocialHome.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' })),
    ],
    [
      'старый API (404)',
      () =>
        getSocialHome.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' })),
    ],
    ['пустой ответ', () => getSocialHome.mockResolvedValue({ items: [] })],
  ])('%s — секции нет, остальная Главная цела', async (_name, arrange) => {
    arrange();
    await openHome();
    expect(await screen.findByText('Ближайшие кофе-райды')).toBeOnTheScreen();
    await waitFor(() => expect(getSocialHome).toHaveBeenCalled());
    expect(screen.queryByText(SECTION)).toBeNull();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });

  it('гость — запроса нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    await openHome();
    expect(getSocialHome).not.toHaveBeenCalled();
    expect(screen.queryByText(SECTION)).toBeNull();
  });
});
