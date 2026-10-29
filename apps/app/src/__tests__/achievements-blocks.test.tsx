/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { Achievement, PublicRiderAchievement } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import OwnProfileRoute from '../app/profile';
import RiderRoute from '../app/riders/[id]';
import { liveSession, signInForTest } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const PUBLIC_ID = 'r'.repeat(43);
const RACE_ID = '0190a6f4-0000-7000-8000-000000000201';
const ROUTE_ID = '0190a6f4-0000-7000-8000-000000000301';

const own = (overrides: Partial<Achievement> = {}): Achievement => ({
  code: 'race_win',
  object: { kind: 'race', id: RACE_ID, title: 'Гонка у озера' },
  factDate: '2026-05-02',
  seen: true,
  ...overrides,
});
const failure = () => new ApiHttpError(500, { code: 'INTERNAL', message: 'x' });
const stub = () => null;

describe('блок «Достижения» своего профиля (AC12)', () => {
  const listAchievements = jest.mocked(api.listAchievements);
  const openProfile = () =>
    renderRouter(
      { profile: OwnProfileRoute, 'achievements/[code]': stub, 'riders/[id]': stub },
      { initialUrl: '/profile', wrapper: createQueryWrapper() },
    );

  beforeEach(() => {
    signInForTest();
    useSessionStore.setState({ session: liveSession });
    jest.mocked(api.getProfile).mockResolvedValue({
      rideReasons: [],
      publicName: 'Анна К.',
      showNameInResults: true,
      club: null,
      avatar: null,
      publicId: null,
    });
    jest.mocked(api.getProfileStats).mockResolvedValue({
      activities: 1,
      distanceM: 1000,
      elevationGainM: 10,
      races: 1,
      podiums: 1,
      bestPlaces: [],
    });
    jest.mocked(api.listProfileRaces).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: null });
    jest.mocked(api.listSeasons).mockResolvedValue({ items: [] });
  });
  afterEach(() => jest.clearAllMocks());

  it('все свои в порядке сервера, незнакомый код отброшен; нажатие → экран достижения', async () => {
    listAchievements.mockResolvedValue({
      items: [
        own({ code: 'route_first', object: { kind: 'route', id: ROUTE_ID, title: 'Петля' } }),
        own({ code: 'unknown' }),
        own({ code: 'race_win' }),
      ],
    });
    const router = await openProfile();
    const block = within(await screen.findByTestId('own-achievements'));
    expect(block.getByRole('header', { name: 'Достижения' })).toBeOnTheScreen();
    const tiles = await block.findAllByRole('button');
    expect(tiles.map((tile) => tile.props.accessibilityLabel)).toEqual([
      'Достижение «Первый маршрут»: Маршрут «Петля», 2 мая 2026',
      'Достижение «Победа»: Гонка «Гонка у озера», 2 мая 2026',
    ]);
    expect(listAchievements).toHaveBeenCalledWith(liveSession.accessToken);

    await fireEvent.press(tiles[1]!);
    await waitFor(() => expect(router.getPathname()).toBe('/achievements/race_win'));
  });

  it('ни одного (или только незнакомые) — блока нет', async () => {
    listAchievements.mockResolvedValue({ items: [own({ code: 'unknown' })] });
    await openProfile();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await waitFor(() => expect(listAchievements).toHaveBeenCalled());
    expect(screen.queryByTestId('own-achievements')).toBeNull();
    expect(screen.queryByText('Достижения')).toBeNull();
  });

  it('ошибка — баннер блока с повтором, профиль на месте; повтор показывает значки', async () => {
    listAchievements.mockRejectedValueOnce(failure()).mockResolvedValue({ items: [own()] });
    await openProfile();
    const block = within(await screen.findByTestId('own-achievements'));
    expect(await block.findByText('Не удалось загрузить достижения')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await fireEvent.press(block.getByRole('button', { name: 'Повторить' }));
    expect(
      await block.findByLabelText('Достижение «Победа»: Гонка «Гонка у озера», 2 мая 2026'),
    ).toBeOnTheScreen();
  });
});

describe('гоночные достижения публичного профиля (A7, AC12)', () => {
  const getRiderAchievements = jest.mocked(api.getRiderAchievements);
  const pub = (overrides: Partial<PublicRiderAchievement> = {}): PublicRiderAchievement => ({
    code: 'race_podium',
    object: { kind: 'race', id: RACE_ID, title: 'Гонка у озера' },
    factDate: '2026-05-02',
    ...overrides,
  });
  const openRider = () =>
    renderRouter(
      { 'riders/[id]': RiderRoute, 'races/[id]': stub, index: stub },
      { initialUrl: `/riders/${PUBLIC_ID}`, wrapper: createQueryWrapper() },
    );

  beforeEach(() => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    jest.mocked(api.getRider).mockResolvedValue({
      publicId: PUBLIC_ID,
      name: 'Анна К.',
      club: null,
      avatar: null,
      stats: { races: 1, podiums: 1, bestPlace: 2 },
    });
    jest.mocked(api.listRiderRaces).mockResolvedValue({ items: [], nextCursor: null });
  });
  afterEach(() => jest.clearAllMocks());

  it('значки без перехода и без «Поделиться»; запрос — после найденного профиля', async () => {
    getRiderAchievements.mockResolvedValue({ items: [pub(), pub({ code: 'unknown' })] });
    await openRider();
    const block = within(await screen.findByTestId('rider-achievements'));
    expect(
      block.getByLabelText('Достижение «Подиум»: Гонка «Гонка у озера», 2 мая 2026'),
    ).toBeOnTheScreen();
    expect(block.queryAllByRole('button')).toEqual([]);
    expect(screen.queryByText('Поделиться')).toBeNull();
    expect(getRiderAchievements).toHaveBeenCalledWith(PUBLIC_ID);
  });

  it('не-гоночные коды в ответе (регресс API) — не показываются (A7)', async () => {
    getRiderAchievements.mockResolvedValue({
      items: [
        pub(),
        pub({ code: 'route_first', object: { kind: 'route', id: ROUTE_ID, title: 'Петля' } }),
      ],
    });
    await openRider();
    const block = within(await screen.findByTestId('rider-achievements'));
    expect(
      block.getByLabelText('Достижение «Подиум»: Гонка «Гонка у озера», 2 мая 2026'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Первый маршрут')).toBeNull();
    expect(screen.queryByText(/Петля/)).toBeNull();
  });

  it('только не-гоночные — блока нет', async () => {
    getRiderAchievements.mockResolvedValue({
      items: [pub({ code: 'ride_first', object: { kind: 'ride', id: ROUTE_ID, title: 'Кофе' } })],
    });
    await openRider();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await waitFor(() => expect(getRiderAchievements).toHaveBeenCalled());
    expect(screen.queryByTestId('rider-achievements')).toBeNull();
  });

  it('пусто — блока нет', async () => {
    getRiderAchievements.mockResolvedValue({ items: [] });
    await openRider();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await waitFor(() => expect(getRiderAchievements).toHaveBeenCalled());
    expect(screen.queryByTestId('rider-achievements')).toBeNull();
  });

  it('ошибка — баннер блока, профиль на месте', async () => {
    getRiderAchievements.mockRejectedValue(failure());
    await openRider();
    expect(await screen.findByText('Не удалось загрузить достижения')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
  });

  it('404 (профиль скрыли между запросами) — блока нет', async () => {
    getRiderAchievements.mockRejectedValue(
      new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }),
    );
    await openRider();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await waitFor(() => expect(getRiderAchievements).toHaveBeenCalled());
    expect(screen.queryByTestId('rider-achievements')).toBeNull();
  });

  it('профиль не найден — достижения не запрашиваются', async () => {
    jest
      .mocked(api.getRider)
      .mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await openRider();
    expect(await screen.findByText('Профиль недоступен')).toBeOnTheScreen();
    expect(getRiderAchievements).not.toHaveBeenCalled();
  });
});
