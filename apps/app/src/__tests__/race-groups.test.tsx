/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RaceResultsPage } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import RivalResultRoute from '../app/races/result/[id]/[entryId]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { myDisputes } from './disputes-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  corridorRace,
  ENTRY_ID,
  finisher,
  finishersPage,
  myEntry,
  noEntryTiers,
  RACE_ID,
  result,
  resultsPage,
  row,
  verifiedState,
} from './races-fixtures';

jest.mock('@/lib/api');

const getRace = jest.mocked(api.getRace);
const getRaceResults = jest.mocked(api.getRaceResults);
const getRaceFinishers = jest.mocked(api.getRaceFinishers);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);

const NOW = new Date('2026-10-08T18:00:00Z');
const never = () => new Promise<never>(() => undefined);
const RIVAL = '0199d000-0000-7000-8000-0000000000f7';

const men = [row({ entryId: '0199d000-0000-7000-8000-0000000000f1', place: 1, elapsedSec: 5400 })];
const women = [
  row({ entryId: RIVAL, place: 1, elapsedSec: 5500, riderName: 'Анна К.' }),
  row({ entryId: ENTRY_ID, place: 2, elapsedSec: 6125 }),
];
const groups: RaceResultsPage['groups'] = [
  { key: 'm_u40', ranked: 1 },
  { key: 'w_u40', ranked: 2 },
];
/** Ответ по умолчанию (первая непустая группа) и вкладка `w_u40`. */
const byGroup = (_id: string, params: { group?: string } = {}) =>
  Promise.resolve(
    params.group === 'w_u40'
      ? resultsPage(women, { group: 'w_u40', groups, finishers: 2 })
      : resultsPage(men, { group: 'm_u40', groups, finishers: 2 }),
  );

const table = () => within(screen.getByTestId('race-results'));
const tab = (name: string) => screen.getByRole('tab', { name });

const openAsGuest = () => renderRouter(appRoutes, { initialUrl: `/races/${RACE_ID}` });
const openSignedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  return renderRouter(
    {
      ...tabRoutes,
      'races/[id]': RaceRoute,
      'races/result/[id]/[entryId]': RivalResultRoute,
    },
    { initialUrl: `/races/${RACE_ID}`, wrapper: createQueryWrapper() },
  );
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRace.mockResolvedValue(corridorRace());
  getRaceResults.mockImplementation(byGroup);
  getRaceFinishers.mockResolvedValue(
    finishersPage([
      finisher(),
      finisher({
        entryId: '0199d000-0000-7000-8000-0000000000d2',
        elapsedSec: 7500,
        riderName: 'Пётр',
        unranked: 'no_heart_rate',
      }),
    ]),
  );
  getMyRaceEntry.mockResolvedValue(noEntryTiers());
  jest.mocked(api.getMyRaceDisputes).mockResolvedValue(myDisputes());
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('таблица: вкладки групп (07c, RC-11)', () => {
  it('вкладки из groups + «Финишёры»; по умолчанию — группа ответа, без group в запросе', async () => {
    await openAsGuest();

    expect(await screen.findByRole('tab', { name: 'Мужчины до 40' })).toBeOnTheScreen();
    expect(tab('Мужчины до 40')).toBeSelected();
    expect(tab('Женщины до 40')).toBeOnTheScreen();
    expect(tab('Финишёры')).toBeOnTheScreen();
    expect(screen.getByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
    expect(getRaceResults).toHaveBeenCalledTimes(1);
    expect(getRaceResults).toHaveBeenCalledWith(RACE_ID, { limit: 50 });
  });

  it('другая вкладка — запрос с group, скелетон до ответа, затем строки группы', async () => {
    await openAsGuest();
    await screen.findByRole('tab', { name: 'Женщины до 40' });
    getRaceResults.mockImplementationOnce(never);

    await fireEvent.press(tab('Женщины до 40'));
    expect(getRaceResults).toHaveBeenLastCalledWith(RACE_ID, { limit: 50, group: 'w_u40' });
    expect(table().getAllByLabelText('Загрузка').length).toBeGreaterThan(0);
  });

  it('другая вкладка — строки группы; назад — кэш группы по умолчанию', async () => {
    await openAsGuest();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Женщины до 40' }));

    expect(await screen.findByLabelText('1, Анна К., 1:31:40')).toBeOnTheScreen();
    expect(table().getByText('Засчитано: 2')).toBeOnTheScreen();
    await fireEvent.press(tab('Мужчины до 40'));
    expect(await screen.findByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
    expect(getRaceResults).toHaveBeenCalledTimes(2);
  });

  it('старый API (groups: []) — без вкладок, group не шлётся', async () => {
    getRaceResults.mockResolvedValue(resultsPage(men));
    await openAsGuest();

    expect(await screen.findByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(getRaceFinishers).not.toHaveBeenCalled();
    expect(getRaceResults).toHaveBeenCalledWith(RACE_ID, { limit: 50 });
  });

  it('вошедший в группе w_u40 — своя вкладка по умолчанию; соперник открывается с ?group', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        groupScheme: 'gender_age',
        entry: { ...myEntry().entry!, tier: 'verified', groupKey: 'w_u40' },
        verified: verifiedState({ ownGroup: 'w_u40', groupOptions: ['w_u40'] }),
        result: result({ status: 'provisional', place: 2, elapsedSec: 6125, group: 'w_u40' }),
      }),
    );
    const router = await openSignedIn();

    expect(await screen.findByLabelText('2, Вы, 1:42:05')).toBeOnTheScreen();
    await waitFor(() => expect(tab('Женщины до 40')).toBeSelected());
    expect(getRaceResults).toHaveBeenCalledWith(RACE_ID, { limit: 50, group: 'w_u40' });

    // карточка соперника читает ту же вкладку таблицы (?group)
    await fireEvent.press(screen.getByRole('button', { name: /Анна К\./ }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/result/${RACE_ID}/${RIVAL}`));
    expect(router.getSearchParams()).toMatchObject({ group: 'w_u40' });
    const card = within(await screen.findByTestId('rival-card'));
    expect(await card.findByText('Анна К.')).toBeOnTheScreen();
    expect(card.queryByText('Результат не найден')).toBeNull();
    expect(getRaceResults).toHaveBeenLastCalledWith(RACE_ID, { limit: 50, group: 'w_u40' });
  });
});

describe('таблица: «Финишёры» (07c)', () => {
  it('строки без места: кто, время, почему без места', async () => {
    await openAsGuest();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Финишёры' }));

    expect(await screen.findByLabelText('Участник, 2:00:00, Финишёр')).toBeOnTheScreen();
    expect(screen.getByLabelText('Пётр, 2:05:00, Без пульса — вне зачёта')).toBeOnTheScreen();
    expect(table().getByText('START и Verified без пульса — время без места.')).toBeOnTheScreen();
    expect(table().queryByText('=1')).toBeNull();
    expect(getRaceFinishers).toHaveBeenCalledWith(RACE_ID, { limit: 50 });
  });

  it('только START (groups: []) — вкладка группы ответа и «Финишёры»', async () => {
    getRaceResults.mockResolvedValue(resultsPage([], { group: 'm_u40', finishers: 1 }));
    await openAsGuest();

    expect(await screen.findByRole('tab', { name: 'Мужчины до 40' })).toBeOnTheScreen();
    expect(table().getByText('Пока нет засчитанных результатов')).toBeOnTheScreen();
    await fireEvent.press(tab('Финишёры'));
    expect(await screen.findByLabelText('Участник, 2:00:00, Финишёр')).toBeOnTheScreen();
    expect(getRaceResults).toHaveBeenCalledTimes(1);
  });

  it('загрузка — скелетон; пусто — текст', async () => {
    getRaceFinishers.mockReturnValueOnce(never());
    await openAsGuest();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Финишёры' }));
    expect(table().getAllByLabelText('Загрузка').length).toBeGreaterThan(0);
  });

  it('пусто — «Пока нет финишёров»', async () => {
    getRaceFinishers.mockResolvedValue(finishersPage([]));
    await openAsGuest();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Финишёры' }));
    expect(await table().findByText('Пока нет финишёров')).toBeOnTheScreen();
  });

  it.each([
    ['сеть', new ApiNetworkError(new Error('offline')), 'Нет соединения'],
    ['сервер', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('ошибка (%s) — баннер с повтором', async (_case, error, title) => {
    await openSignedIn();
    getRaceFinishers.mockRejectedValueOnce(error);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Финишёры' }));

    expect(await table().findByText(title)).toBeOnTheScreen();
    expect(table().getByText('Не удалось загрузить финишёров')).toBeOnTheScreen();
    await fireEvent.press(table().getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByLabelText('Участник, 2:00:00, Финишёр')).toBeOnTheScreen();
  });
});
