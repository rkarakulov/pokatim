/// <reference types="jest" />
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import RivalResultRoute from '../app/races/result/[id]/[entryId]';
import SeasonRoute from '../app/seasons/[id]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { myDisputes, RIVAL_ENTRY_ID } from './disputes-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  corridorRace,
  ENTRY_ID,
  finisher,
  finishersPage,
  myEntry,
  noEntry,
  RACE_ID,
  resultsPage,
  row,
} from './races-fixtures';
import {
  COMPUTED_AT,
  mine,
  SEASON_ID,
  season2026,
  standingRow,
  standingsTable,
  summary,
} from './standings-fixtures';

jest.mock('@/lib/api');

/**
 * Ссылки на публичный профиль и аватары в таблицах (rider-links-in-tables, AC5): строка публичного райдера — аватар и
 * переход на `/riders/<publicId>`; «Участник» — без аватара и не нажимается; прежние действия строки — важнее.
 */

const PUBLIC_ID = 'p'.repeat(43);
const AVATAR_ID = 'a'.repeat(43);
const THIRD = '0199d000-0000-7000-8000-0000000000f3';
const NOW = new Date('2026-10-09T18:00:00Z');

const getRaceResults = jest.mocked(api.getRaceResults);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);
const getMyRaceDisputes = jest.mocked(api.getMyRaceDisputes);

const named = row({
  entryId: RIVAL_ENTRY_ID,
  place: 1,
  elapsedSec: 5400,
  riderName: 'Анна К.',
  riderPublicId: PUBLIC_ID,
  riderAvatar: { id: AVATAR_ID },
});
const rows = [
  named,
  row({ entryId: ENTRY_ID, place: 2, elapsedSec: 6125 }),
  row({ entryId: THIRD, place: 3, elapsedSec: 6400 }),
];

const stub = () => null;
const routes = {
  ...tabRoutes,
  'races/[id]': RaceRoute,
  'races/result/[id]/[entryId]': RivalResultRoute,
  'seasons/[id]': SeasonRoute,
  'riders/[id]': stub,
};
const open = (url: string) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });
const signIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const table = () => within(screen.getByTestId('race-results'));
const profileLink = 'Профиль райдера, Анна К., 1, 1:30:00';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedOut', session: null });
  jest.mocked(api.getRace).mockResolvedValue(corridorRace());
  getRaceResults.mockResolvedValue(resultsPage(rows, { finishers: 2 }));
  jest
    .mocked(api.getRaceFinishers)
    .mockResolvedValue(
      finishersPage([
        finisher({ riderName: 'Пётр', riderPublicId: PUBLIC_ID }),
        finisher({ entryId: '0199d000-0000-7000-8000-0000000000d2', elapsedSec: 7500 }),
      ]),
    );
  getMyRaceEntry.mockResolvedValue(noEntry());
  getMyRaceDisputes.mockResolvedValue(myDisputes());
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

describe('таблица гонки', () => {
  it('гость: публичный райдер — аватар и ссылка на профиль; «Участник» — без аватара и не нажимается', async () => {
    const router = await open(`/races/${RACE_ID}`);

    const link = await screen.findByRole('link', { name: profileLink });
    expect(within(link).getByTestId('rider-avatar-photo')).toBeOnTheScreen();
    expect(table().getAllByTestId('rider-avatar')).toHaveLength(1);
    expect(screen.getByLabelText('2, Участник, 1:42:05')).toBeOnTheScreen();
    expect(table().queryAllByRole('link')).toHaveLength(1);
    expect(table().queryAllByRole('button', { name: /Участник/ })).toHaveLength(0);

    await fireEvent.press(link);
    expect(router.getPathname()).toBe(`/riders/${PUBLIC_ID}`);
  });

  it('публичный райдер без фото — пустой аватар, ссылка есть', async () => {
    getRaceResults.mockResolvedValue(resultsPage([{ ...named, riderAvatar: null }]));
    await open(`/races/${RACE_ID}`);

    const link = await screen.findByRole('link', { name: profileLink });
    expect(within(link).getByTestId('rider-avatar-empty')).toBeOnTheScreen();
  });

  it('карточка соперника важнее ссылки; в карточке — «Профиль райдера»', async () => {
    signIn();
    getMyRaceEntry.mockResolvedValue(myEntry());
    const router = await open(`/races/${RACE_ID}`);

    const rival = await screen.findByRole('button', {
      name: 'Анна К., 1 место, 1:30:00. Открыть карточку',
    });
    expect(screen.queryByRole('link', { name: profileLink })).toBeNull();
    await fireEvent.press(rival);
    expect(router.getPathname()).toBe(`/races/result/${RACE_ID}/${RIVAL_ENTRY_ID}`);

    await fireEvent.press(await screen.findByRole('button', { name: 'Профиль райдера' }));
    expect(router.getPathname()).toBe(`/riders/${PUBLIC_ID}`);
  });

  it('карточка соперника без публичного профиля — без «Профиль райдера»', async () => {
    signIn();
    getMyRaceEntry.mockResolvedValue(myEntry());
    await open(`/races/result/${RACE_ID}/${THIRD}`);

    expect(await screen.findByText('3 место')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Профиль райдера' })).toBeNull();
  });

  it('финишёры: публичный — ссылка с аватаром, «Участник» — нет', async () => {
    const router = await open(`/races/${RACE_ID}`);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Финишёры' }));

    const link = await screen.findByRole('link', {
      name: 'Профиль райдера, Пётр, 2:00:00, Финишёр',
    });
    expect(within(link).getByTestId('rider-avatar')).toBeOnTheScreen();
    expect(screen.getByLabelText('Участник, 2:05:00, Финишёр')).toBeOnTheScreen();
    expect(within(screen.getByTestId('race-finishers')).queryAllByRole('link')).toHaveLength(1);

    await fireEvent.press(link);
    expect(router.getPathname()).toBe(`/riders/${PUBLIC_ID}`);
  });
});

describe('таблица сезона', () => {
  beforeEach(() => {
    jest.mocked(api.getSeason).mockResolvedValue(season2026);
    jest.mocked(api.listSeasons).mockResolvedValue({ items: [season2026] });
    jest.mocked(api.listSeasonRaces).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: season2026 });
    jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(api.getSeasonStandings).mockResolvedValue(summary());
    jest.mocked(api.getMySeasonStandings).mockResolvedValue(mine([], COMPUTED_AT));
    jest.mocked(api.getSeasonStandingsTable).mockResolvedValue(
      standingsTable([
        standingRow({
          order: 0,
          place: 1,
          riderName: 'Анна К.',
          riderPublicId: PUBLIC_ID,
          riderAvatar: { id: AVATAR_ID },
          points: 185,
        }),
        standingRow({ order: 1, place: 2, points: 160 }),
      ]),
    );
  });

  it('публичный райдер — аватар и ссылка; «Участник» — без аватара и ссылки', async () => {
    const router = await open(`/seasons/${SEASON_ID}`);

    const link = await screen.findByRole('link', {
      name: 'Профиль райдера, Анна К., 1, 185 очков',
    });
    expect(within(link).getByTestId('rider-avatar-photo')).toBeOnTheScreen();
    const block = within(screen.getByTestId('season-standings'));
    expect(block.getAllByTestId('rider-avatar')).toHaveLength(1);
    expect(block.getByLabelText('2, Участник, 160 очков')).toBeOnTheScreen();
    expect(block.queryAllByRole('link')).toHaveLength(1);

    await fireEvent.press(link);
    expect(router.getPathname()).toBe(`/riders/${PUBLIC_ID}`);
  });
});
