/// <reference types="jest" />
import type { RespectState, RiderSocial } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import RivalResultRoute from '../app/races/result/[id]/[entryId]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { myDisputes, RIVAL_ENTRY_ID } from './disputes-fixtures';
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

const getRaceResults = jest.mocked(api.getRaceResults);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);
const getMyRaceDisputes = jest.mocked(api.getMyRaceDisputes);
const getRespect = jest.mocked(api.getRaceEntryRespect);
const setRespect = jest.mocked(api.setRaceEntryRespect);
const getRiderSocial = jest.mocked(api.getRiderSocial);

/** «Сейчас»: 9 октября 2026, 21:00 по Минску — приём споров открыт. */
const NOW = new Date('2026-10-09T18:00:00Z');
const TOKEN = liveSession.accessToken;
const RIVAL_PUB = 'r'.repeat(43);
const FAN_PUB = 'f'.repeat(43);

const rows = [
  row({
    entryId: RIVAL_ENTRY_ID,
    place: 1,
    elapsedSec: 5400,
    riderName: 'Анна К.',
    riderPublicId: RIVAL_PUB,
  }),
  row({ entryId: ENTRY_ID, place: 2, elapsedSec: 6125 }),
];
const respect = (over: Partial<RespectState> = {}): RespectState => ({
  available: true,
  respected: false,
  count: 0,
  own: false,
  from: null,
  ...over,
});
const social = (over: Partial<RiderSocial> = {}): RiderSocial => ({
  self: false,
  connected: false,
  together: { rideCount: 0, lastRideAt: null },
  going: null,
  ...over,
});

const routes = {
  ...tabRoutes,
  'races/[id]': RaceRoute,
  'races/result/[id]/[entryId]': RivalResultRoute,
  'riders/[id]': () => null,
};
const open = (url: string) => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  return renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });
};
const rivalUrl = `/races/result/${RACE_ID}/${RIVAL_ENTRY_ID}`;
const ownUrl = `/races/result/${RACE_ID}/${ENTRY_ID}`;
const card = async () => within(await screen.findByTestId('rival-card'));

beforeEach(() => {
  jest.mocked(api.getEventMaterials).mockResolvedValue([]);
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  jest.mocked(api.getRace).mockResolvedValue(corridorRace());
  getRaceResults.mockResolvedValue(resultsPage(rows));
  getMyRaceEntry.mockResolvedValue(myEntry());
  getMyRaceDisputes.mockResolvedValue(myDisputes());
  getRespect.mockResolvedValue(respect());
  getRiderSocial.mockResolvedValue(social());
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('карточка строки любому вошедшему (P4, Q2)', () => {
  it('не-участник: строка таблицы нажимаема; «Респект» и «В свои», без «Оспорить»', async () => {
    getMyRaceEntry.mockResolvedValue(noEntry());
    const router = await open(`/races/${RACE_ID}`);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Анна К., 1 место, 1:30:00. Открыть карточку' }),
    );
    expect(router.getPathname()).toBe(rivalUrl);
    const view = await card();
    expect(await view.findByRole('button', { name: 'Респект' })).toBeOnTheScreen();
    expect(await view.findByRole('button', { name: 'В свои' })).toBeOnTheScreen();
    expect(getRespect).toHaveBeenCalledWith(TOKEN, RACE_ID, RIVAL_ENTRY_ID);
    expect(getRiderSocial).toHaveBeenCalledWith(TOKEN, RIVAL_PUB);
    await waitFor(() => expect(getMyRaceEntry).toHaveBeenCalled());
    expect(view.queryByRole('button', { name: 'Оспорить результат' })).toBeNull();
  });

  it('связь уже есть — «Убрать из своих» без имени райдера (A12)', async () => {
    getMyRaceEntry.mockResolvedValue(noEntry());
    getRiderSocial.mockResolvedValue({ ...social(), connected: true });
    await open(rivalUrl);
    const view = await card();
    const remove = await view.findByRole('button', { name: 'Убрать из своих' });
    expect(within(remove).getByText('Убрать из своих')).toBeOnTheScreen();
    expect(view.queryByRole('button', { name: /Анна/ })).toBeNull();
  });

  it('не-участник после публикации протокола — «Оспорить» не всплывает (RC-P4-10)', async () => {
    getMyRaceEntry.mockResolvedValue(noEntry());
    getMyRaceDisputes.mockResolvedValue(
      myDisputes({ status: 'closed', reason: 'protocol_published' }),
    );
    getRaceResults.mockResolvedValue(resultsPage(rows, { status: 'final' }));
    const view = (await open(rivalUrl), await card());
    expect(await view.findByRole('button', { name: 'Респект' })).toBeOnTheScreen();
    await waitFor(() => expect(getMyRaceEntry).toHaveBeenCalled());
    expect(view.queryByRole('button', { name: 'Оспорить результат' })).toBeNull();
    expect(view.queryByText(/Приём споров закрыт|протокол опубликован/i)).toBeNull();
  });

  it('участник — «Респект» над «Оспорить результат»', async () => {
    await open(rivalUrl);
    const view = await card();
    expect(await view.findByRole('button', { name: 'Оспорить результат' })).toBeOnTheScreen();
    expect(view.getByRole('button', { name: 'Респект' })).toBeOnTheScreen();
  });

  it('«Респект · N» переключается: PUT { respected: true }, затем снять', async () => {
    getRespect.mockResolvedValue(respect({ count: 3 }));
    setRespect.mockResolvedValueOnce(respect({ count: 4, respected: true }));
    await open(rivalUrl);
    const view = await card();
    await fireEvent.press(await view.findByRole('button', { name: 'Респект · 3' }));
    expect(setRespect).toHaveBeenCalledWith(TOKEN, RACE_ID, RIVAL_ENTRY_ID, { respected: true });
    expect(await view.findByRole('button', { name: 'Респект · 4' })).toBeOnTheScreen();
    setRespect.mockResolvedValueOnce(respect({ count: 3, respected: false }));
    await fireEvent.press(view.getByRole('button', { name: 'Респект · 4' }));
    expect(setRespect).toHaveBeenLastCalledWith(TOKEN, RACE_ID, RIVAL_ENTRY_ID, {
      respected: false,
    });
    expect(await view.findByRole('button', { name: 'Респект · 3' })).toBeOnTheScreen();
  });

  it('нет цели (available: false) — кнопки «Респект» нет', async () => {
    getRespect.mockResolvedValue(respect({ available: false }));
    await open(rivalUrl);
    const view = await card();
    expect(await view.findByRole('button', { name: 'Оспорить результат' })).toBeOnTheScreen();
    expect(view.queryByRole('button', { name: /^Респект/ })).toBeNull();
  });

  it('«В свои» — только при `riderPublicId`', async () => {
    getRaceResults.mockResolvedValue(
      resultsPage([{ ...rows[0]!, riderName: null, riderPublicId: null }, rows[1]!]),
    );
    await open(rivalUrl);
    const view = await card();
    expect(await view.findByRole('button', { name: 'Респект' })).toBeOnTheScreen();
    expect(view.queryByRole('button', { name: 'В свои' })).toBeNull();
    expect(getRiderSocial).not.toHaveBeenCalled();
  });
});

describe('своя строка (P4, Q4, RC-P4-11)', () => {
  it('«респект N» и имена поставивших, без кнопки «Респект»', async () => {
    getRespect.mockResolvedValue(
      respect({
        available: false,
        own: true,
        count: 3,
        from: { riders: [{ name: 'Фан Ф.', publicId: FAN_PUB, avatar: null }], hiddenCount: 2 },
      }),
    );
    await open(ownUrl);
    const view = await card();
    expect(await view.findByText('респект 3')).toBeOnTheScreen();
    expect(view.getByText('Фан Ф.')).toBeOnTheScreen();
    expect(view.getByText('и ещё 2')).toBeOnTheScreen();
    expect(view.queryByRole('button', { name: /^Респект/ })).toBeNull();
    expect(view.queryByRole('button', { name: 'В свои' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Оспорить результат' })).toBeNull();
  });

  it('без респектов — блока нет', async () => {
    getRespect.mockResolvedValue(
      respect({ available: false, own: true, from: { riders: [], hiddenCount: 0 } }),
    );
    await open(ownUrl);
    const view = await card();
    await waitFor(() => expect(getRespect).toHaveBeenCalled());
    expect(await screen.findAllByText('Ваш результат')).not.toHaveLength(0);
    expect(await view.findByText('2 место')).toBeOnTheScreen();
    expect(view.queryByTestId('respect-received')).toBeNull();
  });
});

describe('гость (P4)', () => {
  it('строки таблицы не нажимаемы, запроса респекта нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    await renderRouter(appRoutes, { initialUrl: `/races/${RACE_ID}` });
    expect(await screen.findByText('1:30:00')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /Открыть карточку/ })).toBeNull();
    expect(getRespect).not.toHaveBeenCalled();
  });
});
