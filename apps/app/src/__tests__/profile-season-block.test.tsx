/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import OwnProfileRoute from '../app/profile';
import { liveSession, signInForTest } from './auth-fixtures';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';
import { mine, myStanding, SEASON_ID, season2026 } from './standings-fixtures';

jest.mock('@/lib/api');

const getMine = jest.mocked(api.getMySeasonStandings);

const openProfile = (client: QueryClient = createTestQueryClient()) =>
  renderRouter(
    { profile: OwnProfileRoute, 'seasons/[id]': () => null },
    { initialUrl: '/profile', wrapper: createQueryWrapper(client) },
  );
const failure = () => new ApiHttpError(500, { code: 'INTERNAL', message: 'x' });
const refetch = (client: QueryClient, queryKey: readonly unknown[]) =>
  act(async () => {
    await client.refetchQueries({ queryKey });
  });
const block = () => within(screen.getByTestId('profile-season'));

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  jest.mocked(api.getProfile).mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
  });
  // статистика и история своего профиля (rider-profile) — свои тесты в `own-profile.test.tsx`
  jest.mocked(api.getProfileStats).mockReturnValue(new Promise(() => undefined));
  jest.mocked(api.listProfileRaces).mockReturnValue(new Promise(() => undefined));
  jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: season2026 });
  getMine.mockResolvedValue(mine());
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('«Профиль»: блок «Сезон» (08c, RC-18; с rider-profile — на /profile)', () => {
  it('своя строка: место «=1», очки, «{группа} · {класс}»; гонки таблицы — место, очки, в зачёте / не в зачёте / DQ · 0', async () => {
    await openProfile();

    expect(await screen.findByText('Сезон 2026')).toBeOnTheScreen();
    expect(block().getByRole('header', { name: 'Сезон' })).toBeOnTheScreen();
    expect(block().getByText('=1')).toBeOnTheScreen();
    expect(block().getByText('185 очков')).toBeOnTheScreen();
    expect(block().getByText('Мужчины до 40 · Шоссе')).toBeOnTheScreen();
    expect(
      block().getByLabelText('1-е место поровну, 185 очков, Мужчины до 40 · Шоссе'),
    ).toBeOnTheScreen();

    expect(block().getByLabelText('Гонка 1: 2, 85 очков, в зачёте')).toBeOnTheScreen();
    expect(block().getByText('2 · 85 очков')).toBeOnTheScreen();
    expect(block().getByLabelText('Гонка 2: DQ · 0, в зачёте')).toBeOnTheScreen();
    expect(block().getByText('DQ · 0')).toBeOnTheScreen();
    expect(block().getByLabelText('Гонка 3: 3, 75 очков, не в зачёте')).toBeOnTheScreen();
    expect(block().getByText('не в зачёте')).toBeOnTheScreen();
    expect(getMine).toHaveBeenCalledWith(liveSession.accessToken, SEASON_ID);
  });

  it('«Вся таблица» → экран сезона', async () => {
    const router = await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Вся таблица' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/seasons/${SEASON_ID}`));
  });

  it('нет своих строк — блок скрыт', async () => {
    getMine.mockResolvedValue(mine([]));
    await openProfile();
    await screen.findByText('Имя не указано');
    await waitFor(() => expect(getMine).toHaveBeenCalled());

    await waitFor(() => expect(screen.queryByTestId('profile-season')).toBeNull());
    expect(screen.queryByText('Вся таблица')).toBeNull();
  });

  it('нет сезона — блок скрыт, /me не запрашивается', async () => {
    jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: null });
    jest.mocked(api.listSeasons).mockResolvedValue({ items: [] });
    await openProfile();
    await waitFor(() => expect(api.listSeasons).toHaveBeenCalled());

    expect(screen.queryByTestId('profile-season')).toBeNull();
    expect(getMine).not.toHaveBeenCalled();
  });

  it('несколько таблиц — первая своя строка', async () => {
    getMine.mockResolvedValue(
      mine([
        myStanding({ bikeClass: 'gravel', groupKey: 'overall', place: 4, tied: false, points: 67 }),
        myStanding(),
      ]),
    );
    await openProfile();
    expect(await screen.findByText('Общий зачёт · Гравий')).toBeOnTheScreen();
    expect(block().getByText('67 очков')).toBeOnTheScreen();
  });

  it('ошибка без данных — компактная ошибка с повтором', async () => {
    getMine.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openProfile();

    expect(await screen.findByText('Не удалось загрузить сезон')).toBeOnTheScreen();
    await fireEvent.press(block().getByRole('button', { name: 'Повторить' }));
    expect(await block().findByText('185 очков')).toBeOnTheScreen();
  });

  it('отказ определения сезона — баннер с повтором в блоке, повтор показывает рейтинг', async () => {
    jest.mocked(api.getCurrentSeason).mockRejectedValueOnce(failure());
    await openProfile();

    expect(await screen.findByText('Не удалось определить сезон')).toBeOnTheScreen();
    expect(block().getByRole('header', { name: 'Сезон' })).toBeOnTheScreen();
    expect(getMine).not.toHaveBeenCalled();
    await fireEvent.press(block().getByRole('button', { name: 'Повторить' }));
    expect(await block().findByText('185 очков')).toBeOnTheScreen();
  });

  it('отказ обновления сезона после показанного рейтинга — рейтинг остаётся, баннер с повтором', async () => {
    const client = createTestQueryClient();
    await openProfile(client);
    expect(await screen.findByText('185 очков')).toBeOnTheScreen();

    jest.mocked(api.getCurrentSeason).mockRejectedValue(failure());
    await refetch(client, ['seasons', 'current']);
    expect(await block().findByText('Не удалось определить сезон')).toBeOnTheScreen();
    expect(block().getByText('185 очков')).toBeOnTheScreen();
    expect(block().getByText('Сезон 2026')).toBeOnTheScreen();
  });

  it('пустой /me, затем отказ его обновления — блок с баннером и повтором, без строк', async () => {
    const client = createTestQueryClient();
    getMine.mockResolvedValue(mine([]));
    await openProfile(client);
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('profile-season')).toBeNull());

    getMine.mockRejectedValue(failure());
    await refetch(client, ['seasons', 'standings', SEASON_ID, 'me']);
    expect(await screen.findByText('Не удалось загрузить сезон')).toBeOnTheScreen();
    expect(block().getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
    expect(block().queryByText('Вся таблица')).toBeNull();
  });
});
