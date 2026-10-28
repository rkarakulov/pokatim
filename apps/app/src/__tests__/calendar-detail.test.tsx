/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { CalendarStartDetail } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { openExternalUrl } from '@/lib/open-external-url';

import CalendarStartRoute from '../app/calendar/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/lib/open-external-url', () => ({ openExternalUrl: jest.fn() }));

const getCalendarStart = jest.mocked(api.getCalendarStart);
const listCalendar = jest.mocked(api.listCalendar);
const open = jest.mocked(openExternalUrl);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000002';
const URL = 'https://example.by/registration';

const detail: CalendarStartDetail = {
  id: ID,
  title: 'Минская сотка',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: '08:00',
  discipline: 'road',
  city: 'Минск',
  distancesKm: [100, 60],
  registrationUrl: URL,
  phase: 'upcoming',
  place: 'площадь Независимости',
  description: 'Старт у стелы.\nhttps://example.by/route — не ссылка.',
};

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};

/** Вкладки и карточка без корневого layout (вошедший). */
const signedInRoutes = { ...tabRoutes, 'calendar/[id]': CalendarStartRoute };
const openSignedIn = (url: string) =>
  renderRouter(signedInRoutes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getCalendarStart.mockResolvedValue(detail);
  listCalendar.mockResolvedValue({ items: [detail], nextCursor: null });
  jest.mocked(api.listCalendarMonths).mockResolvedValue({ months: ['2027-06'] });
  jest.mocked(api.listCalendarCities).mockResolvedValue({ cities: ['Минск'] });
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.getProfile).mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
  });
  open.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const heroLabel = 'Шоссе · массовый старт · вне приложения. Минская сотка. 14 июня 2027';

describe('карточка старта (AC4)', () => {
  it('маршруты не конфликтуют: /calendar — вкладка, /calendar/<id> — карточка', async () => {
    signedIn();
    const router = await openSignedIn('/calendar');
    expect(await screen.findByRole('header', { name: 'Календарь стартов' })).toBeOnTheScreen();

    await fireEvent.press(await screen.findByRole('link', { name: /^Ближайший старт/ }));
    expect(router.getPathname()).toBe(`/calendar/${ID}`);
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(getCalendarStart).toHaveBeenCalledWith(ID);
  });

  it('гость открывает по ссылке без входа: поля карточки, описание как текст; скрытое — нет', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/calendar/${ID}` });

    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/calendar/${ID}`);
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(screen.getByText('Календарь')).toBeOnTheScreen();
    expect(screen.getByText('Старт в 8:00 · Минск, площадь Независимости')).toBeOnTheScreen();
    expect(screen.getByLabelText('Дистанция 100 км')).toBeOnTheScreen();
    expect(screen.getByLabelText('Дистанция 60 км')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Регистрация у организатора' })).toBeOnTheScreen();
    expect(
      screen.getByText('Откроется сайт организатора. Регистрация и оплата — там.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('О старте')).toBeOnTheScreen();
    const description = screen.getByText(detail.description!);
    expect(description).toHaveProp('selectable', true);
    expect(within(screen.getByTestId('calendar-detail')).queryAllByRole('link')).toHaveLength(0);
    for (const hidden of [
      'Войти',
      'Фото и видео',
      /Комментари/,
      'Этот старт в других разделах',
      'Регистрация открыта',
      'Старт прошёл.',
      'Идёт сейчас.',
      /До старта/,
    ]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
  });

  it('«Регистрация у организатора» → openExternalUrl с адресом организатора', async () => {
    await openSignedIn(`/calendar/${ID}`);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Регистрация у организатора' }),
    );
    expect(open).toHaveBeenCalledWith(URL);
    expect(screen.queryByText('Не удалось открыть сайт организатора.')).toBeNull();
  });

  it('ошибка открытия — баннер под кнопкой', async () => {
    open.mockRejectedValue(new Error('no browser'));
    await openSignedIn(`/calendar/${ID}`);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Регистрация у организатора' }),
    );
    expect(await screen.findByText('Не удалось открыть сайт организатора.')).toBeOnTheScreen();
  });

  it('finished — «Старт прошёл.» без кнопки и пояснения', async () => {
    getCalendarStart.mockResolvedValue({ ...detail, phase: 'finished' });
    await openSignedIn(`/calendar/${ID}`);
    expect(await screen.findByText('Старт прошёл.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Регистрация у организатора' })).toBeNull();
    expect(screen.queryByText(/Откроется сайт организатора/)).toBeNull();
  });

  it('ongoing — «Идёт сейчас.» над кнопкой', async () => {
    getCalendarStart.mockResolvedValue({ ...detail, phase: 'ongoing' });
    await openSignedIn(`/calendar/${ID}`);
    expect(await screen.findByText('Идёт сейчас.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Регистрация у организатора' })).toBeOnTheScreen();
  });

  it.each([null, 'http://example.by/registration', 'javascript:alert(1)'])(
    'ссылка %p — кнопки и пояснения нет',
    async (registrationUrl) => {
      getCalendarStart.mockResolvedValue({ ...detail, registrationUrl });
      await openSignedIn(`/calendar/${ID}`);
      await screen.findByLabelText(heroLabel);
      expect(screen.queryByRole('button', { name: 'Регистрация у организатора' })).toBeNull();
      expect(screen.queryByText(/Откроется сайт организатора/)).toBeNull();
    },
  );

  it("'unknown' дисциплина и фаза — нейтрально; без времени и места — только город", async () => {
    getCalendarStart.mockResolvedValue({
      ...detail,
      discipline: 'unknown',
      phase: 'unknown',
      startTime: null,
      place: null,
      description: null,
    });
    await openSignedIn(`/calendar/${ID}`);
    expect(
      await screen.findByLabelText('Массовый старт · вне приложения. Минская сотка. 14 июня 2027'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Минск')).toBeOnTheScreen();
    expect(screen.queryByText('О старте')).toBeNull();
    expect(screen.getByRole('button', { name: 'Регистрация у организатора' })).toBeOnTheScreen();
  });

  it('«Назад» без истории: гость — на корень (дальше гард ведёт на регистрацию)', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/calendar/${ID}` });
    await screen.findByLabelText(heroLabel);

    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
  });

  it('«Назад» без истории: вошедший — во вкладку «Календарь»', async () => {
    signedIn();
    const router = await openSignedIn(`/calendar/${ID}`);
    await screen.findByLabelText(heroLabel);
    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));
    expect(router.getPathname()).toBe('/calendar');
  });

  it('герой Главной → карточка старта', async () => {
    signedIn();
    const router = await openSignedIn('/');
    await fireEvent.press(
      await screen.findByRole('link', { name: 'Ближайший старт. Минская сотка. 14 июня 2027' }),
    );
    expect(router.getPathname()).toBe(`/calendar/${ID}`);
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
  });

  it('404 — «Старт не найден» + «Все старты» (вошедшему — во вкладку)', async () => {
    signedIn();
    getCalendarStart.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    const router = await openSignedIn(`/calendar/${ID}`);

    expect(await screen.findByText('Старт не найден')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Все старты' }));
    expect(router.getPathname()).toBe('/calendar');
  });

  it('невалидный id — «Старт не найден» без запроса; гость → корень', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/calendar/not-a-uuid' });
    expect(await screen.findByText('Старт не найден')).toBeOnTheScreen();
    expect(getCalendarStart).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Все старты' }));
    expect(router.getPathname()).toBe('/register');
  });

  it('сеть — «Нет соединения» с повтором (AsyncContent)', async () => {
    getCalendarStart.mockRejectedValueOnce(new ApiNetworkError(new TypeError('Failed to fetch')));
    await openSignedIn(`/calendar/${ID}`);

    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
  });

  it('без сети при показанной карточке — баннер «Нет соединения», данные остаются', async () => {
    await openSignedIn(`/calendar/${ID}`);
    await screen.findByLabelText(heroLabel);
    await act(async () => {
      onlineManager.setOnline(false);
    });
    expect(screen.getByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.getByLabelText(heroLabel)).toBeOnTheScreen();
  });
});
