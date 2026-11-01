/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import SeasonRoute from '../app/seasons/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  COMPUTED_AT,
  menRows,
  mine,
  myStanding,
  NEWER_AT,
  SEASON_ID,
  season2026,
  standingRow,
  standingsTable,
  summary,
} from './standings-fixtures';

jest.mock('@/lib/api');

const getSeasonStandings = jest.mocked(api.getSeasonStandings);
const getTable = jest.mocked(api.getSeasonStandingsTable);
const getMine = jest.mocked(api.getMySeasonStandings);

const NOW = new Date('2026-10-21T12:00:00Z');
const never = () => new Promise<never>(() => undefined);

const women = [
  standingRow({ order: 0, place: 1, riderName: 'Вера С.', points: 100 }),
  standingRow({ order: 1, place: 2, points: 85 }),
];
const byTable = (_id: string, params: { bikeClass: string; group: string; cursor?: string }) =>
  Promise.resolve(
    params.group === 'w_u40'
      ? standingsTable(women, { groupKey: 'w_u40' })
      : params.bikeClass === 'gravel'
        ? standingsTable([standingRow({ riderName: 'Глеб' })], {
            bikeClass: 'gravel',
            groupKey: 'overall',
            racesTotal: 1,
            racesCounted: 1,
          })
        : standingsTable(menRows),
  );

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const routes = { ...tabRoutes, 'seasons/[id]': SeasonRoute };
const openSeason = () =>
  renderRouter(routes, { initialUrl: `/seasons/${SEASON_ID}`, wrapper: createQueryWrapper() });
const block = () => within(screen.getByTestId('season-standings'));
const tab = (name: string) => screen.getByRole('tab', { name });
const ownLabel = /Вы/;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  jest.mocked(api.getSeason).mockResolvedValue(season2026);
  jest.mocked(api.listSeasons).mockResolvedValue({ items: [season2026] });
  jest.mocked(api.listSeasonRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: season2026 });
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  getSeasonStandings.mockResolvedValue(summary());
  getTable.mockImplementation(byTable);
  getMine.mockResolvedValue(mine([], COMPUTED_AT));
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

describe('таблица сезона на экране сезона (08c)', () => {
  it('гость: заголовок, подзаголовок, заметка N из M, подпись таблицы, строки «=N», имя или «Участник», очки', async () => {
    await renderRouter(appRoutes, { initialUrl: `/seasons/${SEASON_ID}` });

    expect(await screen.findByRole('header', { name: 'Таблица сезона' })).toBeOnTheScreen();
    expect(await block().findByText('Анна К.')).toBeOnTheScreen();
    expect(
      block().getByText('1 апреля–31 октября 2026 · по последнему пересчёту'),
    ).toBeOnTheScreen();
    expect(
      block().getByText(
        'В зачёт идут финальные результаты Verified: лучшие 2 из 3 гонок. DQ — 0 очков и не выбрасывается.',
      ),
    ).toBeOnTheScreen();
    expect(block().getByText('Мужчины до 40 · Шоссе · 3 участника')).toBeOnTheScreen();
    expect(block().getAllByText('=1')).toHaveLength(2);
    expect(block().getAllByText('Участник')).toHaveLength(2);
    expect(block().getAllByText('185 очков')).toHaveLength(2);
    expect(block().getByLabelText('1-е место поровну, Анна К., 185 очков')).toBeOnTheScreen();
    expect(block().getByLabelText('3, Участник, 160 очков')).toBeOnTheScreen();
    expect(block().queryByText(ownLabel)).toBeNull();
    expect(getTable).toHaveBeenCalledWith(SEASON_ID, {
      bikeClass: 'road',
      group: 'm_u40',
      limit: 50,
    });
    expect(getMine).not.toHaveBeenCalled();
    // блок — над «Гонками сезона»
    expect(screen.getByRole('header', { name: 'Гонки сезона' })).toBeOnTheScreen();
  });

  it('переключатели: только существующие классы и группы; смена класса и группы — запрос той таблицы', async () => {
    await openSeason();
    await block().findByText('Анна К.');

    expect(tab('Шоссе')).toBeSelected();
    expect(tab('Гравий')).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'МТБ' })).toBeNull();
    expect(tab('Мужчины до 40')).toBeSelected();
    expect(screen.queryByRole('tab', { name: 'Мужчины 50+' })).toBeNull();

    await fireEvent.press(tab('Женщины до 40'));
    expect(await block().findByText('Вера С.')).toBeOnTheScreen();
    expect(block().getByText('Женщины до 40 · Шоссе · 2 участника')).toBeOnTheScreen();

    await fireEvent.press(tab('Гравий'));
    expect(await block().findByText('Глеб')).toBeOnTheScreen();
    expect(block().getByText('Общий зачёт · Гравий · 1 участник')).toBeOnTheScreen();
    expect(
      block().getByText(
        'В зачёт идут финальные результаты Verified: лучшие 1 из 1 гонки. DQ — 0 очков и не выбрасывается.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Женщины до 40' })).toBeNull();
    expect(getTable).toHaveBeenLastCalledWith(SEASON_ID, {
      bikeClass: 'gravel',
      group: 'overall',
      limit: 50,
    });
  });

  it('вошедший: открыт на своей таблице, своя строка — «Вы» по order из /me', async () => {
    signedIn();
    getMine.mockResolvedValue(mine([myStanding({ groupKey: 'w_u40', order: 1, place: 2 })]));
    await openSeason();

    expect(await block().findByText('Вы')).toBeOnTheScreen();
    expect(tab('Женщины до 40')).toBeSelected();
    expect(block().getByText('Вера С.')).toBeOnTheScreen();
    expect(block().getByLabelText('2, Вы, 85 очков')).toBeOnTheScreen();
    expect(getMine).toHaveBeenCalledWith(liveSession.accessToken, SEASON_ID);
  });

  it('разный снимок таблицы и /me (RC-11) — без «Вы», таблица перезапрашивается один раз', async () => {
    signedIn();
    getMine.mockResolvedValue(mine([myStanding({ order: 2 })], NEWER_AT));
    await openSeason();
    await block().findByText('Анна К.');

    await waitFor(() => expect(getTable).toHaveBeenCalledTimes(2));
    expect(block().queryByText('Вы')).toBeNull();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(getTable).toHaveBeenCalledTimes(2);

    // новый снимок пришёл — метка появляется
    getTable.mockResolvedValue(standingsTable(menRows, { computedAt: NEWER_AT }));
    const list = screen.getByTestId('season-detail');
    await act(async () => {
      (list.props.refreshControl as ReactElement<RefreshControlProps>).props.onRefresh?.();
    });
    expect(await block().findByText('Вы')).toBeOnTheScreen();
  });

  it('таблица новее /me (RC-11, обратное направление) — один перезапрос /me, таблица не перезапрашивается', async () => {
    signedIn();
    getTable.mockResolvedValue(standingsTable(menRows, { computedAt: NEWER_AT }));
    getMine.mockResolvedValue(mine([myStanding({ order: 2 })], COMPUTED_AT));
    await openSeason();
    await block().findByText('Анна К.');

    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(2));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    expect(getMine).toHaveBeenCalledTimes(2);
    expect(getTable).toHaveBeenCalledTimes(1);
    expect(block().queryByText('Вы')).toBeNull();
  });

  it('первая ошибка /me — свой баннер с повтором, публичная таблица остаётся', async () => {
    signedIn();
    getMine
      .mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }))
      .mockResolvedValue(mine([myStanding({ order: 1 })]));
    await openSeason();

    expect(await block().findByText('Не удалось загрузить ваше место в сезоне')).toBeOnTheScreen();
    expect(block().getByText('Анна К.')).toBeOnTheScreen();
    expect(block().queryByText('Вы')).toBeNull();
    await fireEvent.press(block().getByRole('button', { name: 'Повторить' }));
    expect(await block().findByText('Вы')).toBeOnTheScreen();
    expect(block().queryByText('Не удалось загрузить ваше место в сезоне')).toBeNull();
  });

  it('ошибка обновления /me при данных — «Вы» остаётся, баннер с повтором', async () => {
    signedIn();
    getMine.mockResolvedValue(mine([myStanding({ order: 1 })]));
    await openSeason();
    expect(await block().findByText('Вы')).toBeOnTheScreen();

    getMine.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    const list = screen.getByTestId('season-detail');
    await act(async () => {
      (list.props.refreshControl as ReactElement<RefreshControlProps>).props.onRefresh?.();
    });
    expect(await block().findByText('Не удалось загрузить ваше место в сезоне')).toBeOnTheScreen();
    expect(block().getByText('Вы')).toBeOnTheScreen();
  });

  it('вошедший без сети — «Нет соединения» один раз, не вечный скелетон', async () => {
    signedIn();
    onlineManager.setOnline(false);
    await openSeason();

    expect(await block().findByText('Нет соединения')).toBeOnTheScreen();
    expect(block().getAllByText('Нет соединения')).toHaveLength(1);
    expect(block().queryByLabelText('Загрузка')).toBeNull();
  });

  it('заметка N из M и число участников — из первой страницы таблицы, не из сводки', async () => {
    getTable.mockResolvedValue(
      standingsTable(menRows, { riders: 4, racesTotal: 4, racesCounted: 3 }),
    );
    await openSeason();
    await block().findByText('Анна К.');

    expect(block().getByText('Мужчины до 40 · Шоссе · 4 участника')).toBeOnTheScreen();
    expect(
      block().getByText(
        'В зачёт идут финальные результаты Verified: лучшие 3 из 4 гонок. DQ — 0 очков и не выбрасывается.',
      ),
    ).toBeOnTheScreen();
  });

  it('«Показать ещё» — следующая страница по курсору', async () => {
    getTable
      .mockResolvedValueOnce(standingsTable(menRows.slice(0, 2), { riders: 3, nextCursor: 'c2' }))
      .mockResolvedValueOnce(standingsTable(menRows.slice(2), { riders: 3 }));
    await openSeason();
    await block().findByText('Анна К.');
    expect(block().queryByText('160 очков')).toBeNull();

    await fireEvent.press(block().getByRole('button', { name: 'Показать ещё' }));
    expect(await block().findByText('160 очков')).toBeOnTheScreen();
    expect(getTable).toHaveBeenLastCalledWith(SEASON_ID, {
      bikeClass: 'road',
      group: 'm_u40',
      limit: 50,
      cursor: 'c2',
    });
    expect(block().queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('страница другого снимка — подгруженное сбрасывается, таблица грузится с первой страницы', async () => {
    const fresh = standingsTable([standingRow({ riderName: 'Новый лидер', points: 200 })], {
      computedAt: NEWER_AT,
    });
    getTable
      .mockResolvedValueOnce(standingsTable(menRows.slice(0, 2), { nextCursor: 'c2' }))
      .mockResolvedValueOnce(standingsTable(menRows.slice(2), { computedAt: NEWER_AT }))
      .mockResolvedValue(fresh);
    await openSeason();
    await block().findByText('Анна К.');

    await fireEvent.press(block().getByRole('button', { name: 'Показать ещё' }));
    expect(await block().findByText('Новый лидер')).toBeOnTheScreen();
    expect(block().queryByText('Анна К.')).toBeNull();
    // сброс снимка — в обход HTTP-кэша на всех платформах (iOS NSURLCache, small-followups-api)
    expect(getTable).toHaveBeenLastCalledWith(
      SEASON_ID,
      { bikeClass: 'road', group: 'm_u40', limit: 50 },
      { fresh: true },
    );
  });

  it('таблицы нет в снимке (RC-12) — пустая таблица без ошибки', async () => {
    getTable.mockResolvedValue(standingsTable([], { riders: 0, racesTotal: 0, racesCounted: 0 }));
    await openSeason();

    expect(await block().findByText('В этой таблице пока нет участников')).toBeOnTheScreen();
    expect(block().queryByText('Не удалось загрузить')).toBeNull();
    // счётчики — из пустой страницы, а не из сводки (там 3 участника)
    expect(block().getByText('Мужчины до 40 · Шоссе · 0 участников')).toBeOnTheScreen();
    expect(block().queryByText(/В зачёт идут/)).toBeNull();
  });

  it('пустой сезон — «Сезон только начался», «К гонкам» ведёт во вкладку', async () => {
    signedIn();
    getSeasonStandings.mockResolvedValue(summary([], null));
    const router = await openSeason();

    expect(await block().findByText('Сезон только начался')).toBeOnTheScreen();
    expect(block().getByText('Результаты появятся после первого протокола.')).toBeOnTheScreen();
    expect(getTable).not.toHaveBeenCalled();
    await fireEvent.press(block().getByRole('button', { name: 'К гонкам' }));
    await waitFor(() => expect(router.getPathname()).toBe('/races'));
  });

  it('загрузка — скелетон в блоке', async () => {
    getSeasonStandings.mockReturnValueOnce(never());
    await openSeason();
    expect(await block().findByLabelText('Загрузка')).toBeOnTheScreen();
  });

  it('ошибка сводки — «Не удалось загрузить» с повтором', async () => {
    getSeasonStandings.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    await openSeason();

    expect(await block().findByText('Не удалось загрузить')).toBeOnTheScreen();
    await fireEvent.press(block().getByRole('button', { name: 'Повторить' }));
    expect(await block().findByText('Анна К.')).toBeOnTheScreen();
  });

  it('ошибка таблицы — компактный баннер с повтором, переключатели остаются', async () => {
    getTable.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSeason();

    expect(await block().findByText('Не удалось загрузить таблицу сезона')).toBeOnTheScreen();
    expect(tab('Шоссе')).toBeOnTheScreen();
    await fireEvent.press(block().getByRole('button', { name: 'Повторить' }));
    expect(await block().findByText('Анна К.')).toBeOnTheScreen();
  });

  it('pull-to-refresh перезапрашивает сводку, таблицу и /me', async () => {
    signedIn();
    await openSeason();
    await block().findByText('Анна К.');
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));

    const list = screen.getByTestId('season-detail');
    await act(async () => {
      (list.props.refreshControl as ReactElement<RefreshControlProps>).props.onRefresh?.();
    });
    await waitFor(() => expect(getSeasonStandings).toHaveBeenCalledTimes(2));
    expect(getTable).toHaveBeenCalledTimes(2);
    expect(getMine).toHaveBeenCalledTimes(2);
  });
});

describe('вкладка «Гонки»: «Таблица сезона»', () => {
  it('действие ведёт на экран сезона кнопки шапки', async () => {
    signedIn();
    const router = await renderRouter(routes, {
      initialUrl: '/races',
      wrapper: createQueryWrapper(),
    });

    await fireEvent.press(await screen.findByRole('button', { name: 'Таблица сезона' }));
    expect(router.getPathname()).toBe(`/seasons/${SEASON_ID}`);
  });
});
