/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type {
  CalendarPage,
  CalendarStartCard,
  CatalogRouteCard,
  ProfileView,
  RaceCard,
  RacePage,
  RideCard,
  RidePage,
} from '@pokatim/contracts';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { StyleSheet, type RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { appThemeWrapper } from './app-theme-wrapper';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);
const listRaces = jest.mocked(api.listRaces);
const listCalendar = jest.mocked(api.listCalendar);
const listRides = jest.mocked(api.listRides);
const listRoutes = jest.mocked(api.listCatalogRoutes);
const getRouteMap = jest.mocked(api.getCatalogRouteMap);
const joinRide = jest.mocked(api.joinRide);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');

const race: RaceCard = {
  id: '0190a6f4-0000-7000-8000-000000000001',
  title: 'Гравийный коридор Логойск',
  bikeClass: 'gravel',
  surfaces: ['gravel'],
  distanceKm: 62,
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: { id: '0190a6f4-0000-7000-8000-000000000009', name: 'Сезон 2026' },
};

const start: CalendarStartCard = {
  id: '0190a6f4-0000-7000-8000-000000000002',
  title: 'Минская сотка',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: '09:00',
  discipline: 'road',
  city: 'Минск',
  distancesKm: [80, 120],
  registrationUrl: 'https://example.by/registration',
  phase: 'upcoming',
};

const ride: RideCard = {
  id: '0190a6f4-0000-7000-8000-000000000003',
  title: 'Кофе-райд на Минское море',
  organizerName: null,
  // 3 октября 2026, 9:00 по Минску (суббота)
  startsAt: '2026-10-03T06:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 104,
  paceMinKmh: 25,
  paceMaxKmh: 27,
  limit: 12,
  goingCount: 5,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  route: null,
  start: null,
  viewer: {
    role: 'none',
    canJoin: true,
    canLeave: false,
    canManage: false,
    reported: false,
    canReport: false,
  },
};
const ridePage = (...items: RideCard[]): RidePage => ({ items, nextCursor: null });

const catalogRoute: CatalogRouteCard = {
  id: '0190a6f4-0000-7000-8000-000000000004',
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt', 'gravel'],
  publishedAt: '2026-09-20T10:00:00.000Z',
  author: { kind: 'team' },
};
const routePage = (...items: CatalogRouteCard[]) => ({ items, nextCursor: null });

const racePage = (...items: RaceCard[]): RacePage => ({ items, nextCursor: null });
const calendarPage = (...items: CalendarStartCard[]): CalendarPage => ({ items, nextCursor: null });
const never = () => new Promise<never>(() => undefined);

beforeEach(() => {
  // таймеры идут сами (waitFor работает), «сейчас» — фиксированное
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getProfile.mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
  });
  listRaces.mockResolvedValue(racePage(race));
  listCalendar.mockResolvedValue(calendarPage(start));
  listRides.mockResolvedValue(ridePage(ride));
  listRoutes.mockResolvedValue(routePage(catalogRoute));
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

const profile = (rideReasons: ProfileView['rideReasons']) =>
  getProfile.mockResolvedValue({
    rideReasons,
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
  });

async function openHome() {
  return renderRouter(tabRoutes, { initialUrl: '/', wrapper: createQueryWrapper() });
}

/** Заголовки разделов ленты сверху вниз (словесный знак панели — тоже заголовок, он первый). */
const sectionTitles = () =>
  screen
    .getAllByRole('header')
    .map((header) => header.props.children as string)
    .filter((title) => title !== 'ПОКАТИМ');

describe('Главная: каркас (S3)', () => {
  it('верхняя панель, шапки разделов сразу, скелетоны на месте героев; раздел «Маршруты» (routes-01) (AC3, AC7)', async () => {
    getProfile.mockReturnValue(never());
    listRaces.mockReturnValue(never());
    listCalendar.mockReturnValue(never());
    listRides.mockReturnValue(never());
    listRoutes.mockReturnValue(never());
    await openHome();

    expect(screen.getByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(sectionTitles()).toEqual([
      'Ближайшие гонки',
      'Ближайшие кофе-райды',
      'Маршруты команды',
      'Ближайшие старты',
    ]);
    // кикеры разделов (такие же подписи у вкладок — ищем в ленте)
    const feed = within(screen.getByTestId('home-feed'));
    expect(feed.getByText('Гонки')).toBeOnTheScreen();
    expect(feed.getByText('Кофе-райды')).toBeOnTheScreen();
    expect(feed.getByText('Календарь')).toBeOnTheScreen();
    expect(feed.getByText('Маршруты')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка')).toHaveLength(4);
    expect(screen.queryByText('Маршруты рядом с вами')).toBeNull();
    expect(screen.queryByText('по вашему выбору')).toBeNull();
    // «Выйти» — в «Настройках» (settings-hub), не на Главной
    expect(screen.queryByText('Выйти')).toBeNull();
  });

  it('профиль — Bearer access сессии; «Календарь» в опросе → «Ближайшие старты» первыми с тегом (AC4)', async () => {
    profile(['calendar']);
    await openHome();

    await waitFor(() =>
      expect(sectionTitles()).toEqual([
        'Ближайшие старты',
        'Ближайшие гонки',
        'Ближайшие кофе-райды',
        'Маршруты команды',
      ]),
    );
    expect(screen.getAllByText('по вашему выбору')).toHaveLength(1);
    expect(getProfile).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it('оба раздела отмечены — оба с тегом, порядок вкладок (AC4)', async () => {
    profile(['calendar', 'races']);
    await openHome();

    await waitFor(() => expect(screen.getAllByText('по вашему выбору')).toHaveLength(2));
    expect(sectionTitles()).toEqual([
      'Ближайшие гонки',
      'Ближайшие старты',
      'Ближайшие кофе-райды',
      'Маршруты команды',
    ]);
  });

  it('«Кофе-райды» в опросе (group_rides) поднимает раздел первым с тегом (блок 05)', async () => {
    profile(['group_rides']);
    await openHome();

    await waitFor(() =>
      expect(sectionTitles()).toEqual([
        'Ближайшие кофе-райды',
        'Ближайшие гонки',
        'Маршруты команды',
        'Ближайшие старты',
      ]),
    );
    expect(screen.getAllByText('по вашему выбору')).toHaveLength(1);
  });

  it('«Маршруты» в опросе (routes) поднимает раздел первым с тегом (routes-01)', async () => {
    profile(['routes']);
    await openHome();

    await waitFor(() =>
      expect(sectionTitles()).toEqual([
        'Маршруты команды',
        'Ближайшие гонки',
        'Ближайшие кофе-райды',
        'Ближайшие старты',
      ]),
    );
    expect(screen.getAllByText('по вашему выбору')).toHaveLength(1);
  });

  it.each([['«Пока просто смотрю»', ['exploring'] as const]])(
    '%s — базовый порядок без тегов (AC4)',
    async (_name, reasons) => {
      profile([...reasons]);
      await openHome();

      await waitFor(() => expect(getProfile).toHaveBeenCalled());
      expect(sectionTitles()).toEqual([
        'Ближайшие гонки',
        'Ближайшие кофе-райды',
        'Маршруты команды',
        'Ближайшие старты',
      ]);
      expect(screen.queryByText('по вашему выбору')).toBeNull();
    },
  );

  it('ошибка профиля — базовый порядок, ошибка на экране не показывается (AC4)', async () => {
    getProfile.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openHome();

    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    expect(sectionTitles()).toEqual([
      'Ближайшие гонки',
      'Ближайшие кофе-райды',
      'Маршруты команды',
      'Ближайшие старты',
    ]);
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });

  it('«Все гонки» → вкладка «Гонки», «Все старты» → вкладка «Календарь»', async () => {
    profile([]);
    const router = await openHome();

    await fireEvent.press(screen.getByText('Все гонки'));
    expect(router.getPathname()).toBe('/races');
    expect(screen.getByRole('tab', { name: 'Гонки' })).toBeSelected();

    await fireEvent.press(screen.getByRole('tab', { name: 'Главная' }));
    await fireEvent.press(await screen.findByText('Все старты'));
    expect(router.getPathname()).toBe('/calendar');
  });

  it('pull-to-refresh перезапрашивает разделы и профиль; индикатор — только на время жеста (AC6)', async () => {
    profile(['races']);
    await openHome();
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(1));
    expect(listRaces).toHaveBeenCalledTimes(1);
    expect(listCalendar).toHaveBeenCalledTimes(1);

    const control = () =>
      screen.getByTestId('home-feed').props.refreshControl as ReactElement<RefreshControlProps>;
    expect(control().props.refreshing).toBe(false);

    await act(async () => {
      control().props.onRefresh?.();
    });
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2));
    expect(listRaces).toHaveBeenCalledTimes(2);
    expect(listCalendar).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(control().props.refreshing).toBe(false));
  });
});

describe('Главная: сезонный декор (halloween-decor AC4)', () => {
  it('декор включён в панели — слой поверх ленты, касаний не перехватывает', async () => {
    const getAppearance = jest.mocked(api.getAppearance);
    getAppearance.mockResolvedValue({ themeId: 'classic', decor: 'halloween' });
    await openHome();
    const decor = await screen.findByTestId('halloween-decor', { includeHiddenElements: true });
    expect(decor.props.pointerEvents).toBe('none');
    expect(await screen.findByText('Гравийный коридор Логойск')).toBeOnTheScreen();
    getAppearance.mockReset();
  });

  it('decor: none — слоя нет', async () => {
    const getAppearance = jest.mocked(api.getAppearance);
    getAppearance.mockResolvedValue({ themeId: 'classic', decor: 'none' });
    await openHome();
    await waitFor(() => expect(getAppearance).toHaveBeenCalled());
    await screen.findByText('Гравийный коридор Логойск');
    expect(screen.queryByTestId('halloween-decor', { includeHiddenElements: true })).toBeNull();
    getAppearance.mockReset();
  });
});

describe('Главная: разделы (S4)', () => {
  it('гонка: герой — одна метка, даты окна по Минску, мета, строка фазы; публичный запрос без токена (AC3)', async () => {
    await openHome();

    expect(
      await screen.findByLabelText('Окно гонки. Гравийный коридор Логойск. 4–12 октября'),
    ).toBeOnTheScreen();
    expect(screen.getByText('62 км · Гравий')).toBeOnTheScreen();
    expect(
      screen.getByText('Окно откроется 4 октября, 00:00, закроется 12 октября в 23:59.'),
    ).toBeOnTheScreen();
    // публичные методы — только параметры списка, access не передаётся
    expect(listRaces).toHaveBeenCalledWith({ scope: 'current', limit: 1 });
    expect(listCalendar).toHaveBeenCalledWith({ limit: 1 });
    // «Участвовать» и переходы из героя скрыты (Q6, AC7)
    expect(screen.queryByText('Участвовать')).toBeNull();
  });

  it('старт: дата с годом, дистанции, «До старта N дней», регистрация — только текстом при ссылке (AC3)', async () => {
    await openHome();

    expect(
      await screen.findByLabelText('Ближайший старт. Минская сотка. 14 июня 2027'),
    ).toBeOnTheScreen();
    expect(screen.getByText('80 и 120 км · Шоссе · Минск')).toBeOnTheScreen();
    expect(screen.getByText('До старта 256 дней.')).toBeOnTheScreen();
    expect(screen.getByText('Регистрация у организатора.')).toBeOnTheScreen();
  });

  it('герой старта — ссылка в карточку /calendar/<id> (блок 04)', async () => {
    const router = await renderRouter(
      { ...tabRoutes, 'calendar/[id]': () => null },
      { initialUrl: '/', wrapper: createQueryWrapper() },
    );
    await fireEvent.press(
      await screen.findByRole('link', { name: 'Ближайший старт. Минская сотка. 14 июня 2027' }),
    );
    expect(router.getPathname()).toBe(`/calendar/${start.id}`);
  });

  it('иконка «Настройки» верхней панели ведёт на /settings (settings-hub)', async () => {
    const router = await renderRouter(
      { ...tabRoutes, 'settings/index': () => null },
      { initialUrl: '/', wrapper: createQueryWrapper() },
    );
    const bar = within(await screen.findByTestId('top-bar'));
    expect(bar.getByRole('button', { name: 'Устройства' })).toBeOnTheScreen();
    await fireEvent.press(bar.getByRole('button', { name: 'Настройки' }));
    expect(router.getPathname()).toBe('/settings');
  });

  it('многодневный старт без ссылки регистрации — диапазон, строки регистрации нет', async () => {
    listCalendar.mockResolvedValue(
      calendarPage({
        ...start,
        startsOn: '2026-10-26',
        endsOn: '2026-10-27',
        registrationUrl: null,
      }),
    );
    await openHome();

    expect(
      await screen.findByLabelText('Ближайший старт. Минская сотка. 26–27 октября'),
    ).toBeOnTheScreen();
    expect(screen.getByText('До старта 25 дней.')).toBeOnTheScreen();
    expect(screen.queryByText('Регистрация у организатора.')).toBeNull();
  });

  it('пусто: «Пока нет открытых гонок» + «Календарь стартов» → вкладка «Календарь»; пустой календарь (AC3, Q9)', async () => {
    listRaces.mockResolvedValue(racePage());
    listCalendar.mockResolvedValue(calendarPage());
    const router = await openHome();

    expect(await screen.findByText('Пока нет открытых гонок')).toBeOnTheScreen();
    expect(screen.getByText('Пока нет стартов в календаре')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Календарь стартов'));
    expect(router.getPathname()).toBe('/calendar');
  });

  it('ошибка сервера одного раздела — «Не удалось загрузить» + «Повторить» в его слоте, другой показан (AC5)', async () => {
    listRaces.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openHome();

    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByLabelText('Ближайший старт. Минская сотка. 14 июня 2027')).toBeOnTheScreen();

    listRaces.mockResolvedValue(racePage(race));
    await fireEvent.press(screen.getByText('Повторить'));
    expect(
      await screen.findByLabelText('Окно гонки. Гравийный коридор Логойск. 4–12 октября'),
    ).toBeOnTheScreen();
  });

  it('офлайн-старт — «Нет соединения» сразу; сеть вернулась — данные без действий (AC5)', async () => {
    onlineManager.setOnline(false);
    await openHome();

    expect(await screen.findAllByText('Нет соединения')).toHaveLength(4);
    expect(listRaces).not.toHaveBeenCalled();

    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(
      await screen.findByLabelText('Окно гонки. Гравийный коридор Логойск. 4–12 октября'),
    ).toBeOnTheScreen();
  });

  it('ошибка фонового обновления при данных — данные остаются, баннер с повтором (AC5)', async () => {
    await openHome();
    await screen.findByLabelText('Окно гонки. Гравийный коридор Логойск. 4–12 октября');

    listRaces.mockRejectedValue(new ApiNetworkError(new Error('offline')));
    const control = () =>
      screen.getByTestId('home-feed').props.refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      control().props.onRefresh?.();
    });

    expect(await screen.findByText('Повторить')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Окно гонки. Гравийный коридор Логойск. 4–12 октября'),
    ).toBeOnTheScreen();
  });

  it("'unknown' в фазе, покрытиях и дисциплине — герой без строки и подписей, экран не падает (AC5, R9)", async () => {
    listRaces.mockResolvedValue(racePage({ ...race, phase: 'unknown', surfaces: ['unknown'] }));
    listCalendar.mockResolvedValue(calendarPage({ ...start, discipline: 'unknown' }));
    await openHome();

    expect(
      await screen.findByLabelText('Окно гонки. Гравийный коридор Логойск. 4–12 октября'),
    ).toBeOnTheScreen();
    expect(screen.getByText('62 км')).toBeOnTheScreen();
    expect(screen.queryByText(/Окно откроется|Окно открыто|Окно закрывается/)).toBeNull();
    expect(screen.getByText('80 и 120 км · Минск')).toBeOnTheScreen();
  });
});

describe('Главная: раздел «Кофе-райды» (блок 05, S6)', () => {
  const rideHero = 'Ближайший райд. Кофе-райд на Минское море. Сб 3 октября, 9:00';

  it('герой — первый райд ленты (limit 1, Bearer), мета, стопка и «Я иду»; «Все райды» → вкладка', async () => {
    const router = await renderRouter(
      { ...tabRoutes, 'rides/[id]': () => null },
      { initialUrl: '/', wrapper: createQueryWrapper() },
    );

    expect(await screen.findByLabelText(rideHero)).toBeOnTheScreen();
    expect(listRides).toHaveBeenCalledWith(liveSession.accessToken, { limit: 1 });
    expect(screen.getByText('104 км · темп 25–27 км/ч · Минск, Парк Победы')).toBeOnTheScreen();
    expect(screen.getByText('идут 5 из 12')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Я иду' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText(rideHero));
    expect(router.getPathname()).toBe(`/rides/${ride.id}`);
  });

  it('«Я иду» с Главной — запрос с Bearer, после ответа раздел перезапрошен', async () => {
    joinRide.mockResolvedValue({
      ride: { ...ride, goingCount: 6, description: null },
      viewer: {
        role: 'participant',
        canJoin: false,
        canLeave: true,
        canManage: false,
        reported: false,
        canReport: false,
      },
    });
    await openHome();
    await fireEvent.press(await screen.findByRole('button', { name: 'Я иду' }));

    expect(joinRide).toHaveBeenCalledWith(liveSession.accessToken, ride.id);
    await waitFor(() => expect(listRides).toHaveBeenCalledTimes(2));
  });

  it('пусто — «Пока нет кофе-райдов» + «Создать райд» → форма; «Все райды» → вкладка «Райды»', async () => {
    listRides.mockResolvedValue(ridePage());
    const router = await renderRouter(
      { ...tabRoutes, 'rides/new': () => null },
      { initialUrl: '/', wrapper: createQueryWrapper() },
    );

    expect(await screen.findByText('Пока нет кофе-райдов')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Создать райд'));
    expect(router.getPathname()).toBe('/rides/new');
  });

  it('«Все райды» → вкладка «Райды»', async () => {
    const router = await openHome();
    await fireEvent.press(await screen.findByText('Все райды'));
    expect(router.getPathname()).toBe('/rides');
  });
});

describe('Главная: обновление (ревью pass 1)', () => {
  const control = () =>
    screen.getByTestId('home-feed').props.refreshControl as ReactElement<RefreshControlProps>;
  const raceHero = 'Окно гонки. Гравийный коридор Логойск. 4–12 октября';

  afterEach(() => focusManager.setFocused(undefined));

  it('жест без сети при данных — индикатор снимается сразу, баннер «Нет соединения»; сеть вернулась — перезапрос сам', async () => {
    await openHome();
    await screen.findByLabelText(raceHero);
    expect(screen.queryByText('Нет соединения')).toBeNull();

    await act(async () => {
      onlineManager.setOnline(false);
    });
    await act(async () => {
      await control().props.onRefresh?.();
    });

    expect(control().props.refreshing).toBe(false);
    expect(screen.getByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.getByLabelText(raceHero)).toBeOnTheScreen();
    expect(listRaces).toHaveBeenCalledTimes(1);

    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(listRaces).toHaveBeenCalledTimes(2));
    expect(listCalendar).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });

  it('возврат в фокус после staleTime и смены суток Минска: разделы перезапрошены (профиль — нет), тот же ответ — новая подпись', async () => {
    // 1 октября 23:00 по Минску; старт 3 октября — через 2 дня
    jest.setSystemTime(new Date('2026-10-01T20:00:00Z'));
    listCalendar.mockResolvedValue(calendarPage({ ...start, startsOn: '2026-10-03' }));
    await openHome();
    expect(await screen.findByText('До старта 2 дня.')).toBeOnTheScreen();

    // приложение в фоне полтора часа: в Минске уже 2 октября; ответ API тот же
    await act(async () => {
      focusManager.setFocused(false);
    });
    jest.setSystemTime(new Date('2026-10-01T21:30:00Z'));
    await act(async () => {
      focusManager.setFocused(true);
    });

    expect(await screen.findByText('До старта 1 день.')).toBeOnTheScreen();
    expect(listRaces).toHaveBeenCalledTimes(2);
    expect(listCalendar).toHaveBeenCalledTimes(2);
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('полночь по Минску на открытом экране — подписи пересчитаны без запроса', async () => {
    jest.setSystemTime(new Date('2026-10-01T20:59:00Z'));
    listCalendar.mockResolvedValue(calendarPage({ ...start, startsOn: '2026-10-03' }));
    await openHome();
    expect(await screen.findByText('До старта 2 дня.')).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTimeAsync(2 * 60_000));

    expect(screen.getByText('До старта 1 день.')).toBeOnTheScreen();
    expect(listCalendar).toHaveBeenCalledTimes(1);
  });
});

describe('Главная: раздел «Маршруты» (routes-01, AC7)', () => {
  it('герой — последний опубликованный маршрут (limit 1, публичный): длина крупно, название, мета; ведёт в /routes/<id>', async () => {
    const router = await renderRouter(
      { ...tabRoutes, 'routes/[id]': () => null },
      { initialUrl: '/', wrapper: createQueryWrapper() },
    );
    const hero = await screen.findByLabelText(/^Маршрут команды\. Минское кольцо/);
    expect(listRoutes).toHaveBeenCalledWith({ limit: 1 });
    expect(screen.getByText('86 км · набор 412 м · петля')).toBeOnTheScreen();
    expect(screen.getByText('Минск · асфальт, гравий')).toBeOnTheScreen();
    await fireEvent.press(hero);
    expect(router.getPathname()).toBe(`/routes/${catalogRoute.id}`);
  });

  it('пустой каталог — раздел на месте с «Маршрутов пока нет»; «Все маршруты» → вкладка', async () => {
    listRoutes.mockResolvedValue(routePage());
    const router = await openHome();
    expect(await screen.findByText('Маршрутов пока нет')).toBeOnTheScreen();
    expect(sectionTitles()).toContain('Маршруты команды');
    await fireEvent.press(screen.getByText('Все маршруты'));
    expect(router.getPathname()).toBe('/routes');
  });
});

describe('Главная: герой «Маршрутов» по теме (app-themes C2, F1)', () => {
  const geometry = {
    line: [
      [27.5, 53.9],
      [27.6, 53.95],
      [27.7, 53.9],
    ] as [number, number][],
    start: [27.5, 53.9] as [number, number],
    finish: [27.7, 53.9] as [number, number],
    bounds: [27.5, 53.9, 27.7, 53.95] as [number, number, number, number],
  };

  const hidden = { includeHiddenElements: true };

  /** Главная под темой: QueryClient + тема приложения. */
  async function openThemed(themeId: 'classic' | 'atlas' | 'typography') {
    const Query = createQueryWrapper();
    const Theme = appThemeWrapper(themeId);
    return renderRouter(
      { ...tabRoutes, 'routes/[id]': () => null },
      {
        initialUrl: '/',
        wrapper: ({ children }: { children: ReactElement }) => (
          <Query>
            <Theme>{children}</Theme>
          </Query>
        ),
      },
    );
  }

  it('«Классика» — текстовый герой без запроса карты (RC-8)', async () => {
    await openThemed('classic');
    const hero = await screen.findByLabelText(/^Маршрут команды\. Минское кольцо/);
    expect(within(hero).getByTestId('section-hero-rule', hidden)).toBeOnTheScreen();
    expect(getRouteMap).not.toHaveBeenCalled();
  });

  it('Атлас — контур: пока геометрия грузится — скелетон панели; затем путь; ссылка в карточку', async () => {
    let resolve: (value: typeof geometry) => void = () => undefined;
    getRouteMap.mockReturnValue(new Promise((r) => (resolve = r)));
    const router = await openThemed('atlas');
    const hero = await screen.findByLabelText(/^Маршрут команды\. Минское кольцо/);
    expect(screen.getByTestId('route-hero-contour-skeleton', hidden)).toBeOnTheScreen();
    expect(getRouteMap).toHaveBeenCalledTimes(1);
    expect(getRouteMap).toHaveBeenCalledWith(catalogRoute.id);
    await act(async () => resolve(geometry));
    expect(await screen.findByTestId('route-contour', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('route-hero-contour-skeleton', hidden)).toBeNull();
    expect(screen.getByText('86 км · набор 412 м · петля')).toBeOnTheScreen();
    // кнопка-стрелка декоративная: второй цели нажатия нет
    expect(screen.getAllByRole('link', { name: /Минское кольцо/ })).toHaveLength(1);
    await fireEvent.press(hero);
    expect(router.getPathname()).toBe(`/routes/${catalogRoute.id}`);
  });

  it('Атлас — кнопка-стрелка героя с прямыми углами: радиус shape.button, как у «Классики»', async () => {
    getRouteMap.mockResolvedValue(geometry);
    await openThemed('atlas');
    const arrow = await screen.findByTestId('route-hero-arrow', hidden);
    expect(StyleSheet.flatten(arrow.props.style).borderRadius).toBe(0);
  });

  it('Атлас — ошибка /map: панель без контура, тихо', async () => {
    getRouteMap.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'нет' }));
    await openThemed('atlas');
    await screen.findByLabelText(/^Маршрут команды\. Минское кольцо/);
    await waitFor(() =>
      expect(screen.queryByTestId('route-hero-contour-skeleton', hidden)).toBeNull(),
    );
    expect(screen.getByTestId('route-hero-panel', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('route-contour', hidden)).toBeNull();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });

  it('Типографика — крупная дистанция и контур на диагональном блоке', async () => {
    getRouteMap.mockResolvedValue(geometry);
    await openThemed('typography');
    const hero = await screen.findByLabelText(/^Маршрут команды\. Минское кольцо/);
    expect(within(hero).getByTestId('route-hero-numeral', hidden)).toHaveTextContent('86км');
    expect(await within(hero).findByTestId('route-contour', hidden)).toBeOnTheScreen();
    expect(within(hero).queryByTestId('section-hero-rule', hidden)).toBeNull();
  });

  it.each([
    ['atlas', 'route-hero-skeleton-contour'],
    ['typography', 'route-hero-skeleton-numeral'],
  ] as const)('%s — первая загрузка раздела: скелетон героя варианта', async (themeId, testID) => {
    listRoutes.mockReturnValue(never());
    await openThemed(themeId);
    expect(await screen.findByTestId(testID, hidden)).toBeOnTheScreen();
  });
});
