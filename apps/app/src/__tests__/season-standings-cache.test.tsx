/// <reference types="jest" />
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import SeasonRoute from '../app/seasons/[id]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  menRows,
  mine,
  myStanding,
  NEWER_AT,
  SEASON_ID,
  season2026,
  standingsTable,
  summary,
} from './standings-fixtures';

jest.mock('@/lib/api');

const getTable = jest.mocked(api.getSeasonStandingsTable);
const params = { bikeClass: 'road', group: 'm_u40', limit: 50 };
const block = () => within(screen.getByTestId('season-standings'));
const openSeason = () =>
  renderRouter(
    { ...tabRoutes, 'seasons/[id]': SeasonRoute },
    { initialUrl: `/seasons/${SEASON_ID}`, wrapper: createQueryWrapper() },
  );

beforeEach(() => {
  jest.mocked(api.getSeason).mockResolvedValue(season2026);
  jest.mocked(api.listSeasons).mockResolvedValue({ items: [season2026] });
  jest.mocked(api.listSeasonRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.getSeasonStandings).mockResolvedValue(summary());
  jest.mocked(api.getMySeasonStandings).mockResolvedValue(mine([]));
  getTable.mockResolvedValue(standingsTable(menRows));
});
afterEach(() => jest.clearAllMocks());

describe('перезапросы после расхождения снимков — в обход HTTP-кэша (ревью 08c pass 1)', () => {
  it('RC-11: первый запрос — обычный, перезапрос таблицы — fresh', async () => {
    useSessionStore.setState({ status: 'signedIn', session: liveSession });
    useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
    jest
      .mocked(api.getMySeasonStandings)
      .mockResolvedValue(mine([myStanding({ order: 2 })], NEWER_AT));
    await openSeason();
    await block().findByText('Анна К.');

    await waitFor(() => expect(getTable).toHaveBeenCalledTimes(2));
    expect(getTable.mock.calls[0]).toEqual([SEASON_ID, params]);
    expect(getTable.mock.calls[1]).toEqual([SEASON_ID, params, { fresh: true }]);
  });

  it('страница другого снимка — первая страница грузится заново fresh', async () => {
    getTable
      .mockResolvedValueOnce(standingsTable(menRows.slice(0, 2), { nextCursor: 'c2' }))
      .mockResolvedValueOnce(standingsTable(menRows.slice(2), { computedAt: NEWER_AT }))
      .mockResolvedValue(standingsTable(menRows, { computedAt: NEWER_AT }));
    await openSeason();
    await block().findByText('Анна К.');

    await fireEvent.press(block().getByRole('button', { name: 'Показать ещё' }));
    await waitFor(() => expect(getTable).toHaveBeenCalledTimes(3));
    expect(getTable.mock.calls[1]).toEqual([SEASON_ID, { ...params, cursor: 'c2' }]);
    expect(getTable.mock.calls[2]).toEqual([SEASON_ID, params, { fresh: true }]);
    await act(async () => undefined);
  });
});
