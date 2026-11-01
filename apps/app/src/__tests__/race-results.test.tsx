/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  corridorRace,
  ENTRY_ID,
  myEntry,
  noEntry,
  RACE_ID,
  resultsPage,
  row,
} from './races-fixtures';

jest.mock('@/lib/api');

const getRace = jest.mocked(api.getRace);
const getRaceResults = jest.mocked(api.getRaceResults);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);

/** «Сейчас»: 8 октября 2026, 21:00 по Минску — окно открыто. */
const NOW = new Date('2026-10-08T18:00:00Z');

const rows = [
  row({ entryId: '0199d000-0000-7000-8000-0000000000f1', place: 1, elapsedSec: 5400 }),
  row({ entryId: ENTRY_ID, place: 2, tied: true, elapsedSec: 6125 }),
  row({ entryId: '0199d000-0000-7000-8000-0000000000f3', place: 2, tied: true, elapsedSec: 6125 }),
];

const table = () => within(screen.getByTestId('race-results'));

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};

const openAsGuest = () => renderRouter(appRoutes, { initialUrl: `/races/${RACE_ID}` });
/** Без корневого layout: клиент запросов без повторов — ошибка видна сразу. */
const openSignedIn = () => {
  signedIn();
  return renderRouter(
    { ...tabRoutes, 'races/[id]': RaceRoute },
    { initialUrl: `/races/${RACE_ID}`, wrapper: createQueryWrapper() },
  );
};

beforeEach(() => {
  // материалы события (event-tickets PR C): по умолчанию у события их нет — блока нет
  jest.mocked(api.getEventMaterials).mockResolvedValue([]);
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRace.mockResolvedValue(corridorRace());
  getRaceResults.mockResolvedValue(resultsPage(rows, { ranked: 3 }));
  getMyRaceEntry.mockResolvedValue(noEntry());
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

describe('предварительная таблица (AC10, AC17)', () => {
  it('гость: строки «Участник», ничья «=2», время h:mm:ss, «Засчитано», «Предварительный»; «Вы» — нет', async () => {
    await openAsGuest();

    expect(await screen.findByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
    expect(table().getByRole('header', { name: 'Результаты' })).toBeOnTheScreen();
    expect(table().getByText('Предварительный')).toBeOnTheScreen();
    expect(table().getByText('Засчитано: 3')).toBeOnTheScreen();
    expect(table().getAllByText('=2')).toHaveLength(2);
    expect(table().getAllByText('1:42:05')).toHaveLength(2);
    expect(table().getAllByText('Участник')).toHaveLength(3);
    expect(table().queryByText('Вы')).toBeNull();
    expect(screen.getAllByLabelText('2-е место поровну, Участник, 1:42:05')).toHaveLength(2);
    expect(getRaceResults).toHaveBeenCalledWith(RACE_ID, { limit: 50 });
  });

  it('вошедший: своя строка — «Вы» по id своей заявки', async () => {
    getMyRaceEntry.mockResolvedValue(myEntry());
    await openSignedIn();

    // строки вошедшему нажимаемы (P4 Q2, RC-P4-11): своя — «Вы»
    expect(
      await screen.findByRole('button', { name: 'Вы, =2 место, 1:42:05. Открыть карточку' }),
    ).toBeOnTheScreen();
    expect(table().getAllByText('Участник')).toHaveLength(2);
    expect(table().getByText('Вы')).toBeOnTheScreen();
  });

  it('«Показать ещё» — следующая страница по курсору', async () => {
    getRaceResults
      .mockResolvedValueOnce(resultsPage(rows.slice(0, 1), { ranked: 3, nextCursor: 'c2' }))
      .mockResolvedValueOnce(resultsPage(rows.slice(1), { ranked: 3 }));
    await openAsGuest();

    await screen.findByLabelText('1, Участник, 1:30:00');
    await fireEvent.press(table().getByRole('button', { name: 'Показать ещё' }));
    expect(getRaceResults).toHaveBeenLastCalledWith(RACE_ID, { limit: 50, cursor: 'c2' });
    expect(await screen.findAllByLabelText('2-е место поровну, Участник, 1:42:05')).toHaveLength(2);
    expect(table().queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('пусто — «Пока нет засчитанных результатов»', async () => {
    getRaceResults.mockResolvedValue(resultsPage());
    await openAsGuest();

    expect(await screen.findByText('Пока нет засчитанных результатов')).toBeOnTheScreen();
  });

  it('ошибка — баннер с «Повторить», поля карточки видны', async () => {
    getRaceResults.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSignedIn();

    expect(await screen.findByText('Не удалось загрузить результаты')).toBeOnTheScreen();
    expect(screen.getByText('±50 м от маршрута')).toBeOnTheScreen();
    await fireEvent.press(table().getByRole('button', { name: 'Повторить' }));
    // вошедшему строка — кнопка карточки (P4 Q2)
    expect(
      await screen.findByRole('button', { name: 'Участник, 1 место, 1:30:00. Открыть карточку' }),
    ).toBeOnTheScreen();
  });

  it.each([
    ['до открытия окна', corridorRace({ phase: 'upcoming' })],
    ['отменена', corridorRace({ phase: 'cancelled' })],
    ['без коридора', corridorRace({ corridor: null })],
  ])('%s — таблицы нет, запроса нет', async (_case, race) => {
    getRace.mockResolvedValue(race);
    await openAsGuest();

    expect(await screen.findByText('Дистанция')).toBeOnTheScreen();
    await waitFor(() => expect(getRace).toHaveBeenCalled());
    expect(screen.queryByTestId('race-results')).toBeNull();
    expect(getRaceResults).not.toHaveBeenCalled();
  });

  it('закрыта — таблица есть', async () => {
    getRace.mockResolvedValue(corridorRace({ phase: 'closed' }));
    await openAsGuest();

    expect(await screen.findByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
  });
});
