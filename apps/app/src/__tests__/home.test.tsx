/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type {
  CalendarPage,
  CalendarStartCard,
  ProfileView,
  RaceCard,
  RacePage,
} from '@pokatim/contracts';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);
const listRaces = jest.mocked(api.listRaces);
const listCalendar = jest.mocked(api.listCalendar);

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
};

const racePage = (...items: RaceCard[]): RacePage => ({ items, nextCursor: null });
const calendarPage = (...items: CalendarStartCard[]): CalendarPage => ({ items, nextCursor: null });
const never = () => new Promise<never>(() => undefined);

beforeEach(() => {
  // таймеры идут сами (waitFor работает), «сейчас» — фиксированное
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getProfile.mockResolvedValue({ rideReasons: [] });
  listRaces.mockResolvedValue(racePage(race));
  listCalendar.mockResolvedValue(calendarPage(start));
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

const profile = (rideReasons: ProfileView['rideReasons']) =>
  getProfile.mockResolvedValue({ rideReasons });

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
  it('верхняя панель, шапки разделов сразу, скелетоны на месте героев; Маршрутов и Кофе-райдов нет (AC3, AC7)', async () => {
    getProfile.mockReturnValue(never());
    listRaces.mockReturnValue(never());
    listCalendar.mockReturnValue(never());
    await openHome();

    expect(screen.getByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
    // кикеры разделов (такие же подписи у вкладок — ищем в ленте)
    const feed = within(screen.getByTestId('home-feed'));
    expect(feed.getByText('Гонки')).toBeOnTheScreen();
    expect(feed.getByText('Календарь')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка')).toHaveLength(2);
    expect(screen.queryByText('Маршруты рядом с вами')).toBeNull();
    expect(screen.queryByText('Кофе-райды')).toBeNull();
    expect(screen.queryByText('по вашему выбору')).toBeNull();
    // временно внизу Главной (Q8)
    expect(screen.getByText('Выйти')).toBeOnTheScreen();
  });

  it('профиль — Bearer access сессии; «Календарь» в опросе → «Ближайшие старты» первыми с тегом (AC4)', async () => {
    profile(['calendar']);
    await openHome();

    await waitFor(() => expect(sectionTitles()).toEqual(['Ближайшие старты', 'Ближайшие гонки']));
    expect(screen.getAllByText('по вашему выбору')).toHaveLength(1);
    expect(getProfile).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it('оба раздела отмечены — оба с тегом, порядок вкладок (AC4)', async () => {
    profile(['calendar', 'races']);
    await openHome();

    await waitFor(() => expect(screen.getAllByText('по вашему выбору')).toHaveLength(2));
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
  });

  it.each([
    ['«Пока просто смотрю»', ['exploring'] as const],
    ['раздел без бэкенда', ['routes'] as const],
  ])('%s — базовый порядок без тегов (AC4)', async (_name, reasons) => {
    profile([...reasons]);
    await openHome();

    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
    expect(screen.queryByText('по вашему выбору')).toBeNull();
  });

  it('ошибка профиля — базовый порядок, ошибка на экране не показывается (AC4)', async () => {
    getProfile.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openHome();

    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    expect(sectionTitles()).toEqual(['Ближайшие гонки', 'Ближайшие старты']);
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

    expect(await screen.findAllByText('Нет соединения')).toHaveLength(2);
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
