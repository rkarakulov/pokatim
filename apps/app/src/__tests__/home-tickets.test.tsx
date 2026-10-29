/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { MyTicketRef } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { calendarTicket, raceTicket, ticketRef } from '@/features/tickets/fixtures';
import { api } from '@/lib/api';

import TicketRoute from '../app/tickets/[code]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
// офлайн-копии — без файлов: проверяем только предзагрузку запросом
jest.mock('@/features/tickets/offline-store', () => ({
  saveOfflineTicket: jest.fn(async () => undefined),
  readOfflineTicket: jest.fn(async () => null),
  removeOfflineTicket: jest.fn(async () => undefined),
  clearOfflineTickets: jest.fn(async () => undefined),
}));

const listTickets = jest.mocked(api.listTickets);
const getTicket = jest.mocked(api.getTicket);

const ref = (code: string, patch: Partial<MyTicketRef> = {}): MyTicketRef => ({
  ...ticketRef(raceTicket),
  code,
  ...patch,
});

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  jest.mocked(api.getProfile).mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
    themeId: 'classic',
  });
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRides).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCatalogRoutes).mockResolvedValue({ items: [], nextCursor: null });
  getTicket.mockImplementation(async (_token, code) => ({ ...raceTicket, code }));
});
afterEach(() => jest.clearAllMocks());

const openHome = () =>
  renderRouter(
    { ...tabRoutes, 'tickets/[code]': TicketRoute },
    { initialUrl: '/', wrapper: createQueryWrapper() },
  );

describe('«Ваши билеты» на Главной (§5.7, RC-B6)', () => {
  it('пусто — блока нет, без скелетона', async () => {
    listTickets.mockResolvedValue({ upcoming: [], past: [ref('ZZZZZ00000', { past: true })] });
    await openHome();
    await waitFor(() => expect(listTickets).toHaveBeenCalledWith(liveSession.accessToken));
    await screen.findByTestId('home-feed');
    expect(screen.queryByTestId('home-tickets')).toBeNull();
    expect(screen.queryByText('Ваши билеты')).toBeNull();
  });

  it('ошибка без данных — блока нет, без повтора', async () => {
    listTickets.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openHome();
    await waitFor(() => expect(listTickets).toHaveBeenCalled());
    await screen.findByTestId('home-feed');
    expect(screen.queryByTestId('home-tickets')).toBeNull();
  });

  it('до 3 ближайших без отменённых райдером; нажатие — билет', async () => {
    listTickets.mockResolvedValue({
      upcoming: [
        ref('AAAAA00001'),
        ref('AAAAA00002', { status: 'cancelled' }),
        { ...ticketRef(calendarTicket), code: 'AAAAA00003' },
        ref('AAAAA00004', { status: 'event_cancelled' }),
        ref('AAAAA00005'),
      ],
      past: [],
    });
    const router = await openHome();

    const block = within(await screen.findByTestId('home-tickets'));
    expect(block.getByText('Ваши билеты')).toBeOnTheScreen();
    const rows = block.getAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAccessibleName('Гонка «Минское кольцо». Пн 14 июня 2027, 8:00. Активен');
    expect(block.getByText('Старт календаря · Вс 20 июня 2027, 8:00')).toBeOnTheScreen();
    expect(block.getByText('Событие отменено')).toBeOnTheScreen();

    await fireEvent.press(rows[0]!);
    await waitFor(() => expect(router.getPathname()).toBe('/tickets/AAAAA00001'));
  });

  it('предзагрузка ≤ 3 ближайших билетов (офлайн-копии без открытия, RC-B8)', async () => {
    listTickets.mockResolvedValue({
      upcoming: ['BBBBB00001', 'BBBBB00002', 'BBBBB00003', 'BBBBB00004'].map((code) => ref(code)),
      past: [],
    });
    await openHome();
    await screen.findByTestId('home-tickets');
    await waitFor(() => expect(getTicket).toHaveBeenCalledTimes(3));
    expect(getTicket.mock.calls.map(([, code]) => code)).toEqual([
      'BBBBB00001',
      'BBBBB00002',
      'BBBBB00003',
    ]);
  });
});
