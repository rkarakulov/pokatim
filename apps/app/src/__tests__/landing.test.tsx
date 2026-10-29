/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type {
  CalendarPage,
  CalendarStartCard,
  CatalogRouteCard,
  CatalogRoutePage,
  CurrentSeasonResponse,
  RaceCard,
  RacePage,
  SeasonCard,
} from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { router as expoRouter } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import WelcomeRoute from '@/app/welcome';
import { LandingScreen } from '@/features/landing/landing-screen';
import { api } from '@/lib/api';

import { appRoutes } from './app-routes';
import { storeSession, storeSurveyCompleted } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const listRaces = jest.mocked(api.listRaces);
const getCurrentSeason = jest.mocked(api.getCurrentSeason);
const listRoutes = jest.mocked(api.listCatalogRoutes);
const listCalendar = jest.mocked(api.listCalendar);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const HERO = 'Катайтесь вместе и соревнуйтесь на своих маршрутах';

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

const season: SeasonCard = {
  id: '0190a6f4-0000-7000-8000-000000000009',
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
};

const route = (n: number, overrides: Partial<CatalogRouteCard> = {}): CatalogRouteCard => ({
  id: `0190a6f4-0000-7000-8000-00000000010${n}`,
  title: `Маршрут ${n}`,
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-09-20T10:00:00.000Z',
  author: { kind: 'team' },
  ...overrides,
});

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

const racePage = (...items: RaceCard[]): RacePage => ({ items, nextCursor: null });
const routePage = (...items: CatalogRouteCard[]): CatalogRoutePage => ({ items, nextCursor: null });
const calendarPage = (...items: CalendarStartCard[]): CalendarPage => ({ items, nextCursor: null });
const currentSeason = (value: SeasonCard | null): CurrentSeasonResponse => ({ season: value });
const never = () => new Promise<never>(() => undefined);

const RACE_LABEL = 'Окно гонки. Гравийный коридор Логойск. 4–12 октября';
const START_LABEL = 'Ближайший старт. Минская сотка. 14 июня 2027';
const SEASON_LABEL = 'Сезон 2026. 1 апреля–31 октября 2026. Текущий';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  listRaces.mockResolvedValue(racePage(race));
  getCurrentSeason.mockResolvedValue(currentSeason(season));
  listRoutes.mockResolvedValue(routePage(route(1), route(2), route(3)));
  listCalendar.mockResolvedValue(calendarPage(start));
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

/** Лендинг без корневого layout: клиент запросов без повторов — ошибка видна сразу. */
const openLanding = () =>
  renderRouter(
    { welcome: WelcomeRoute, 'races/[id]': () => null },
    { initialUrl: '/welcome', wrapper: createQueryWrapper() },
  );

/** Заголовки экрана сверху вниз. */
const headers = () =>
  screen.getAllByRole('header').map((header) => header.props.children as string);

describe('лендинг гостя /welcome: структура (G3)', () => {
  it('семь блоков по порядку, тексты разделов; знак «Покатим» — не заголовок (RC-6)', async () => {
    await openLanding();

    expect(headers()).toEqual([
      HERO,
      'Гонки по маршруту',
      'Сезон',
      'Кофе-райды',
      'Маршруты',
      'Календарь стартов',
      'Поехали?',
    ]);
    expect(screen.getByText('ПОКАТИМ')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Покатим' })).toBeNull();
    expect(
      screen.getByText(
        'Гонки по маршруту с результатами, сезонный зачёт, кофе-райды и каталог проверенных маршрутов — в одном приложении.',
      ),
    ).toBeOnTheScreen();
    for (const text of [
      'Проезжайте маршрут гонки в любой день окна, загружайте трек с устройства — результат и место появятся в протоколе.',
      'Очки за гонки складываются в общий зачёт сезона — по классам, полу и возрасту.',
      'Соберите покатушку с остановкой на кофе или присоединитесь к чужой: время, место, темп и кто едет.',
      'Маршруты команды с картой, профилем высоты и GPX — откройте и поезжайте.',
      'Массовые велостарты в одном календаре: даты, дистанции и ссылка на регистрацию у организатора.',
    ]) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
    // герой и нижний призыв — по две кнопки
    expect(screen.getAllByRole('button', { name: 'Зарегистрироваться' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Войти' })).toHaveLength(2);
    await screen.findByLabelText(RACE_LABEL);
  });

  it('живые данные: герой гонки, строка сезона, до 3 маршрутов команды, герой старта ведут на карточки (G4, RC-5)', async () => {
    const router = await openLanding();

    expect(await screen.findByLabelText(RACE_LABEL)).toBeOnTheScreen();
    expect(await screen.findByLabelText(SEASON_LABEL)).toBeOnTheScreen();
    expect(await screen.findByLabelText(START_LABEL)).toBeOnTheScreen();
    expect(await screen.findAllByRole('link', { name: /^Маршрут \d\./ })).toHaveLength(3);
    expect(listRoutes).toHaveBeenCalledWith({ author: ['team'], limit: 3 });
    expect(listRaces).toHaveBeenCalledWith({ scope: 'current', limit: 1 });
    expect(listCalendar).toHaveBeenCalledWith({ limit: 1 });

    await fireEvent.press(screen.getByLabelText(RACE_LABEL));
    expect(router.getPathname()).toBe(`/races/${race.id}`);
  });

  it.each([
    ['сезон', () => screen.getByLabelText(SEASON_LABEL), `/seasons/${season.id}`],
    ['маршрут', () => screen.getByRole('link', { name: /^Маршрут 2\./ }), `/routes/${route(2).id}`],
    ['старт', () => screen.getByLabelText(START_LABEL), `/calendar/${start.id}`],
  ])('%s ведёт на карточку', async (_name, target, path) => {
    const router = await renderRouter(
      {
        welcome: WelcomeRoute,
        'seasons/[id]': () => null,
        'routes/[id]': () => null,
        'calendar/[id]': () => null,
      },
      { initialUrl: '/welcome', wrapper: createQueryWrapper() },
    );
    await screen.findByLabelText(START_LABEL);
    await screen.findByLabelText(SEASON_LABEL);
    await screen.findAllByRole('link', { name: /^Маршрут \d\./ });

    await fireEvent.press(target());
    expect(router.getPathname()).toBe(path);
  });
});

describe('лендинг: пусто и ошибки (G5, RC-4)', () => {
  it('пустые разделы — тексты разделов и пустые подписи без действий; сезона нет — без строки', async () => {
    listRaces.mockResolvedValue(racePage());
    getCurrentSeason.mockResolvedValue(currentSeason(null));
    listRoutes.mockResolvedValue(routePage());
    listCalendar.mockResolvedValue(calendarPage());
    await openLanding();

    expect(await screen.findByText('Пока нет открытых гонок')).toBeOnTheScreen();
    expect(await screen.findByText('Маршрутов пока нет')).toBeOnTheScreen();
    expect(await screen.findByText('Пока нет стартов в календаре')).toBeOnTheScreen();
    // пустой гонке не предлагаем вкладку «Календарь стартов» под гардом
    expect(screen.queryByRole('button', { name: 'Календарь стартов' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Сезон 2026/ })).toBeNull();
    expect(
      screen.getByText(
        'Очки за гонки складываются в общий зачёт сезона — по классам, полу и возрасту.',
      ),
    ).toBeOnTheScreen();
  });

  it.each([
    ['500', () => new ApiHttpError(500, { code: 'INTERNAL', message: 'x' })],
    ['нет сети', () => new ApiNetworkError(new TypeError('Failed to fetch'))],
  ])(
    'ошибка API (%s) — тексты на месте, живых блоков и экрана ошибки нет',
    async (_name, error) => {
      listRaces.mockRejectedValue(error());
      getCurrentSeason.mockRejectedValue(error());
      listRoutes.mockRejectedValue(error());
      listCalendar.mockRejectedValue(error());
      await openLanding();

      await waitFor(() => expect(listCalendar).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByTestId('landing-skeleton')).toBeNull());
      expect(headers()).toHaveLength(7);
      expect(screen.queryByText('Не удалось загрузить')).toBeNull();
      expect(screen.queryByText('Нет соединения')).toBeNull();
      expect(screen.queryByText('Повторить')).toBeNull();
      expect(screen.queryByLabelText(RACE_LABEL)).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.queryByText('Пока нет открытых гонок')).toBeNull();
    },
  );

  it('частичный сбой — упавший раздел без блока, остальные с данными', async () => {
    listRaces.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openLanding();

    expect(await screen.findByLabelText(START_LABEL)).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByTestId('landing-skeleton')).toBeNull());
    expect(screen.queryByLabelText(RACE_LABEL)).toBeNull();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });

  it('первая загрузка — скелетоны в слотах живых блоков', async () => {
    listRaces.mockReturnValue(never());
    getCurrentSeason.mockReturnValue(never());
    listRoutes.mockReturnValue(never());
    listCalendar.mockReturnValue(never());
    await openLanding();

    expect(screen.getAllByTestId('landing-skeleton')).toHaveLength(4);
    expect(headers()).toHaveLength(7);
  });

  it('офлайн без данных — без вечного скелетона; сеть вернулась — данные', async () => {
    onlineManager.setOnline(false);
    await openLanding();

    expect(screen.queryByTestId('landing-skeleton')).toBeNull();
    expect(listRaces).not.toHaveBeenCalled();
    expect(screen.queryByText('Нет соединения')).toBeNull();

    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(await screen.findByLabelText(RACE_LABEL)).toBeOnTheScreen();
  });
});

describe('лендинг: посев SSR (G6)', () => {
  it('данные посева — с первого рендера, без ожидания запроса', async () => {
    listRaces.mockReturnValue(never());
    getCurrentSeason.mockReturnValue(never());
    listRoutes.mockReturnValue(never());
    listCalendar.mockReturnValue(never());
    await renderRouter(
      {
        welcome: () => (
          <LandingScreen
            seed={{
              races: racePage(race),
              season: currentSeason(season),
              routes: routePage(route(1)),
              calendar: calendarPage(start),
            }}
          />
        ),
      },
      { initialUrl: '/welcome', wrapper: createQueryWrapper() },
    );

    expect(screen.getByLabelText(RACE_LABEL)).toBeOnTheScreen();
    expect(screen.getByLabelText(SEASON_LABEL)).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: /^Маршрут 1\./ })).toBeOnTheScreen();
    expect(screen.getByLabelText(START_LABEL)).toBeOnTheScreen();
    expect(screen.queryByTestId('landing-skeleton')).toBeNull();
  });

  it('часть посева `null` (API не ответил) — этот раздел догружается запросом', async () => {
    await renderRouter(
      {
        welcome: () => (
          <LandingScreen
            seed={{ races: null, season: null, routes: null, calendar: calendarPage(start) }}
          />
        ),
      },
      { initialUrl: '/welcome', wrapper: createQueryWrapper() },
    );

    expect(screen.getByLabelText(START_LABEL)).toBeOnTheScreen();
    expect(await screen.findByLabelText(RACE_LABEL)).toBeOnTheScreen();
    expect(listCalendar).not.toHaveBeenCalled();
  });
});

describe('лендинг: переходы и гард (G1, G2)', () => {
  it('«Зарегистрироваться» — регистрация, «назад» — лендинг; «Войти» — вход', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/welcome' });
    expect(await screen.findByRole('header', { name: HERO })).toBeOnTheScreen();

    await fireEvent.press(screen.getAllByRole('button', { name: 'Зарегистрироваться' })[0]!);
    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');

    await act(() => expoRouter.back());
    expect(await screen.findByRole('header', { name: HERO })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');

    await fireEvent.press(screen.getAllByRole('button', { name: 'Войти' })[1]!);
    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'));
  });

  it('новый гость с `/` — лендинг', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: HERO })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
  });

  it('вошедший на /welcome — Главная', async () => {
    storeSession();
    storeSurveyCompleted();
    const router = await renderRouter(appRoutes, { initialUrl: '/welcome' });

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });
});
