/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RaceDetail } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getRace = jest.mocked(api.getRace);
const listRaces = jest.mocked(api.listRaces);
const listCalendar = jest.mocked(api.listCalendar);
const getProfile = jest.mocked(api.getProfile);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000001';
const SEASON_ID = '0190a6f4-0000-7000-8000-000000000009';

const race: RaceDetail = {
  id: ID,
  title: 'Гравийный коридор Логойск',
  bikeClass: 'gravel',
  surfaces: ['gravel', 'asphalt'],
  distanceKm: 62,
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: { id: SEASON_ID, name: 'Сезон 2026' },
  description: 'Старт у озера.\nhttps://example.by/route — не ссылка.',
};

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done' });
};

/** Вкладки и карточка без корневого layout (вошедший). */
const signedInRoutes = { ...tabRoutes, 'races/[id]': RaceRoute };

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRace.mockResolvedValue(race);
  listRaces.mockResolvedValue({ items: [race], nextCursor: null });
  listCalendar.mockResolvedValue({ items: [], nextCursor: null });
  getProfile.mockResolvedValue({ rideReasons: [] });
  jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: null });
  jest.mocked(api.listSeasons).mockResolvedValue({ items: [] });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

const heroLabel = 'Гонка · Гравий. Гравийный коридор Логойск. 4–12 октября 2026';

describe('карточка гонки (AC5)', () => {
  it('маршруты не конфликтуют: /races — вкладка, /races/<id> — карточка (R4)', async () => {
    signedIn();
    const router = await renderRouter(signedInRoutes, {
      initialUrl: '/races',
      wrapper: createQueryWrapper(),
    });
    expect(await screen.findByRole('header', { name: 'Гонки' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/races');

    await fireEvent.press(await screen.findByRole('link', { name: /^Ближайшая гонка/ }));
    expect(router.getPathname()).toBe(`/races/${ID}`);
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(getRace).toHaveBeenCalledWith(ID);
  });

  it('гость открывает по ссылке без входа: поля карточки, сезон ссылкой, описание как текст; скрытое — нет', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/races/${ID}` });

    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/races/${ID}`);
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(screen.getByText('4–12 октября 2026, до 23:59')).toBeOnTheScreen();
    expect(screen.getByText('Окно откроется 4 октября 2026, 00:00')).toBeOnTheScreen();
    expect(screen.getByText('62 км')).toBeOnTheScreen();
    expect(screen.getByText('Гравий · Асфальт')).toBeOnTheScreen();
    expect(screen.getByText('14 октября 2026 (план)')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Сезон 2026' })).toBeOnTheScreen();
    const description = screen.getByText(race.description!);
    expect(description).toHaveProp('selectable', true);
    expect(within(screen.getByTestId('race-detail')).queryAllByRole('link')).toHaveLength(0);
    for (const hidden of ['Участвовать', 'Поделиться', 'Результаты', /Коридор/, /Ваше участие/]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    // tab-bar нет: карточка поверх вкладок (Q8)
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
  });

  it('«Назад» без истории: гость — на корень (дальше гард ведёт на регистрацию)', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/races/${ID}` });
    await screen.findByLabelText(heroLabel);

    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));
    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
  });

  it('«Назад» без истории: вошедший — во вкладку «Гонки»', async () => {
    signedIn();
    const router = await renderRouter(signedInRoutes, {
      initialUrl: `/races/${ID}`,
      wrapper: createQueryWrapper(),
    });
    await screen.findByLabelText(heroLabel);

    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));
    expect(router.getPathname()).toBe('/races');
  });

  it('герой Главной → карточка гонки (Q12)', async () => {
    signedIn();
    const router = await renderRouter(signedInRoutes, {
      initialUrl: '/',
      wrapper: createQueryWrapper(),
    });

    await fireEvent.press(
      await screen.findByRole('link', {
        name: 'Окно гонки. Гравийный коридор Логойск. 4–12 октября',
      }),
    );
    expect(router.getPathname()).toBe(`/races/${ID}`);
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
  });

  it('404 — «Гонка не найдена» + «Все гонки» (вошедшему — во вкладку)', async () => {
    signedIn();
    getRace.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    const router = await renderRouter(signedInRoutes, {
      initialUrl: `/races/${ID}`,
      wrapper: createQueryWrapper(),
    });

    expect(await screen.findByText('Гонка не найдена')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Все гонки' }));
    expect(router.getPathname()).toBe('/races');
  });

  it('невалидный id — «Гонка не найдена» без запроса', async () => {
    await renderRouter(signedInRoutes, {
      initialUrl: '/races/not-a-uuid',
      wrapper: createQueryWrapper(),
    });

    expect(await screen.findByText('Гонка не найдена')).toBeOnTheScreen();
    expect(getRace).not.toHaveBeenCalled();
  });

  it('сеть — «Нет соединения» с повтором (AsyncContent)', async () => {
    getRace.mockRejectedValueOnce(new ApiNetworkError(new TypeError('Failed to fetch')));
    await renderRouter(signedInRoutes, {
      initialUrl: `/races/${ID}`,
      wrapper: createQueryWrapper(),
    });

    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
  });

  it("отменённая — баннер «Гонка отменена. Причина: …», строк окна и протокола нет; 'unknown' — нейтрально", async () => {
    getRace.mockResolvedValue({
      ...race,
      phase: 'cancelled',
      cancelReason: 'unknown',
      bikeClass: 'unknown',
      surfaces: ['unknown'],
      season: null,
      description: null,
    });
    await renderRouter(signedInRoutes, {
      initialUrl: `/races/${ID}`,
      wrapper: createQueryWrapper(),
    });

    expect(await screen.findByText('Гонка отменена.')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Гонка. Гравийный коридор Логойск. 4–12 октября 2026'),
    ).toBeOnTheScreen();
    for (const absent of ['Окно', 'Протокол', 'Класс', 'Покрытие', 'Сезон', 'Описание']) {
      expect(screen.queryByText(absent)).toBeNull();
    }
  });
});
