/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RaceCard, RaceDetail, SeasonCard } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import SeasonRoute from '../app/seasons/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getSeason = jest.mocked(api.getSeason);
const listSeasons = jest.mocked(api.listSeasons);
const listSeasonRaces = jest.mocked(api.listSeasonRaces);
const getCurrentSeason = jest.mocked(api.getCurrentSeason);
const listRaces = jest.mocked(api.listRaces);
const getRace = jest.mocked(api.getRace);

const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000026';
const PREV_ID = '0190a6f4-0000-7000-8000-000000000025';
const NEXT_ID = '0190a6f4-0000-7000-8000-000000000027';

const s2027: SeasonCard = {
  id: NEXT_ID,
  name: 'Сезон 2027',
  startsOn: '2027-04-01',
  endsOn: '2027-10-31',
  phase: 'upcoming',
};
const s2026: SeasonCard = {
  id: ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
};
const s2025: SeasonCard = {
  id: PREV_ID,
  name: 'Сезон 2025',
  startsOn: '2025-04-01',
  endsOn: '2025-10-31',
  phase: 'finished',
};
const seasons = [s2027, s2026, s2025];

const race = (n: number, overrides: Partial<RaceCard> = {}): RaceDetail => ({
  id: `0190a6f4-0000-7000-8000-00000000010${n}`,
  title: `Гонка сезона ${n}`,
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 40 + n,
  windowStartsAt: '2026-05-01T21:00:00Z',
  windowEndsAt: '2026-05-03T20:59:00Z',
  protocolPlannedAt: '2026-05-06T09:00:00Z',
  phase: 'closed',
  cancelReason: null,
  season: { id: ID, name: 'Сезон 2026' },
  description: null,
  ...overrides,
});

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done' });
};
const routes = { ...tabRoutes, 'races/[id]': RaceRoute, 'seasons/[id]': SeasonRoute };

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getSeason.mockImplementation((id) =>
    Promise.resolve(seasons.find((season) => season.id === id) ?? s2026),
  );
  listSeasons.mockResolvedValue({ items: seasons });
  listSeasonRaces.mockResolvedValue({ items: [race(1), race(2)], nextCursor: null });
  getCurrentSeason.mockResolvedValue({ season: s2026 });
  listRaces.mockResolvedValue({ items: [], nextCursor: null });
  getRace.mockResolvedValue(race(1));
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('экран сезона (AC7)', () => {
  it('гость по ссылке: название, даты с годом, фаза, гонки сезона, «Другие сезоны»; таблицы и мест нет', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/seasons/${ID}` });

    expect(await screen.findByRole('header', { name: 'Сезон 2026' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/seasons/${ID}`);
    expect(screen.getByText('1 апреля–31 октября 2026')).toBeOnTheScreen();
    expect(screen.getByText('Текущий')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Гонки сезона' })).toBeOnTheScreen();
    expect(await screen.findByText('Гонка сезона 1')).toBeOnTheScreen();
    expect(screen.getAllByText('2–3')[0]!).toBeOnTheScreen();
    expect(screen.getAllByText('мая 2026')).toHaveLength(2);
    expect(listSeasonRaces).toHaveBeenCalledWith(ID, { limit: 20 });
    expect(await screen.findByRole('header', { name: 'Другие сезоны' })).toBeOnTheScreen();
    expect(
      screen.getByRole('link', { name: 'Сезон 2027. 1 апреля–31 октября 2027. Предстоящий' }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('link', { name: 'Сезон 2025. 1 апреля–31 октября 2025. Завершён' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: /^Сезон 2026/ })).toBeNull();
    for (const hidden of ['Таблица сезона', 'Вы', /место/i, /В зачёт/, /Сезон только начался/]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
  });

  it('«Другие сезоны» → экран того сезона; карточка гонки сезона → /races/<id>', async () => {
    signedIn();
    const router = await renderRouter(routes, {
      initialUrl: `/seasons/${ID}`,
      wrapper: createQueryWrapper(),
    });

    await fireEvent.press(await screen.findByRole('link', { name: /^Сезон 2025/ }));
    expect(router.getPathname()).toBe(`/seasons/${PREV_ID}`);
    expect(await screen.findByText('Завершён')).toBeOnTheScreen();

    await fireEvent.press((await screen.findAllByRole('link', { name: /^Гонка сезона 1/ }))[0]!);
    expect(router.getPathname()).toBe(`/races/${race(1).id}`);
  });

  it('гонки сезона — подгрузка по курсору у конца списка', async () => {
    listSeasonRaces
      .mockResolvedValueOnce({ items: [race(1)], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [race(2)], nextCursor: null });
    await renderRouter(routes, { initialUrl: `/seasons/${ID}`, wrapper: createQueryWrapper() });
    await screen.findByText('Гонка сезона 1');

    await act(async () => {
      screen.getByTestId('season-detail').props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(await screen.findByText('Гонка сезона 2')).toBeOnTheScreen();
    expect(listSeasonRaces).toHaveBeenLastCalledWith(ID, { limit: 20, cursor: 'c2' });
  });

  it('пусто — «В сезоне пока нет гонок»', async () => {
    listSeasonRaces.mockResolvedValue({ items: [], nextCursor: null });
    await renderRouter(routes, { initialUrl: `/seasons/${ID}`, wrapper: createQueryWrapper() });

    expect(await screen.findByText('В сезоне пока нет гонок')).toBeOnTheScreen();
  });

  it('404 — «Сезон не найден»', async () => {
    getSeason.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await renderRouter(routes, { initialUrl: `/seasons/${ID}`, wrapper: createQueryWrapper() });
    expect(await screen.findByText('Сезон не найден')).toBeOnTheScreen();
  });

  it('невалидный id — «Сезон не найден» без запроса', async () => {
    await renderRouter(routes, { initialUrl: '/seasons/current', wrapper: createQueryWrapper() });
    expect(await screen.findByText('Сезон не найден')).toBeOnTheScreen();
    expect(getSeason).not.toHaveBeenCalled();
    expect(listSeasonRaces).not.toHaveBeenCalled();
  });

  it('карточка гонки: ссылка сезона → экран сезона', async () => {
    signedIn();
    const router = await renderRouter(routes, {
      initialUrl: `/races/${race(1).id}`,
      wrapper: createQueryWrapper(),
    });

    await fireEvent.press(await screen.findByRole('button', { name: 'Сезон 2026' }));
    expect(router.getPathname()).toBe(`/seasons/${ID}`);
    expect(await screen.findByRole('header', { name: 'Гонки сезона' })).toBeOnTheScreen();
  });
});

describe('кнопка сезона во вкладке «Гонки» (Q3, R10)', () => {
  beforeEach(signedIn);

  it('текущий сезон — кнопка с названием → экран сезона', async () => {
    const router = await renderRouter(routes, {
      initialUrl: '/races',
      wrapper: createQueryWrapper(),
    });

    await fireEvent.press(await screen.findByRole('button', { name: 'Сезон 2026' }));
    expect(router.getPathname()).toBe(`/seasons/${ID}`);
  });

  it('между сезонами — ближайший предстоящий; без предстоящих — последний завершённый', async () => {
    getCurrentSeason.mockResolvedValue({ season: null });
    listSeasons.mockResolvedValue({
      items: [{ ...s2027 }, { ...s2026, phase: 'finished' }, s2025],
    });
    await renderRouter(routes, { initialUrl: '/races', wrapper: createQueryWrapper() });
    expect(await screen.findByRole('button', { name: 'Сезон 2027' })).toBeOnTheScreen();
  });

  it('сезонов нет — кнопки нет', async () => {
    getCurrentSeason.mockResolvedValue({ season: null });
    listSeasons.mockResolvedValue({ items: [] });
    await renderRouter(routes, { initialUrl: '/races', wrapper: createQueryWrapper() });

    expect(await screen.findByText('Пока нет открытых гонок')).toBeOnTheScreen();
    expect(listSeasons).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Сезон/ })).toBeNull();
  });
});
