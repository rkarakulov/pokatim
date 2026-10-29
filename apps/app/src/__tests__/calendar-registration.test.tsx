/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type {
  CalendarRegistrationState,
  CalendarStartDetail,
  EventTicketingPublic,
} from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import * as returnPath from '@/features/auth/return-path';
import { useSessionStore } from '@/features/auth/session-store';
import { removeOfflineTicket } from '@/features/tickets/offline-store';
import { api } from '@/lib/api';
import { openExternalUrl } from '@/lib/open-external-url';

import CalendarStartRoute from '../app/calendar/[id]';
import TicketRoute from '../app/tickets/[code]';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/lib/open-external-url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/features/tickets/offline-store', () => ({
  saveOfflineTicket: jest.fn(async () => undefined),
  readOfflineTicket: jest.fn(async () => null),
  removeOfflineTicket: jest.fn(async () => undefined),
  clearOfflineTickets: jest.fn(async () => undefined),
}));

const ID = '0190a6f4-0000-7000-8000-000000000002';
const TOKEN = liveSession.accessToken;
const getTicketing = jest.mocked(api.getEventTicketing);
const getRegistration = jest.mocked(api.getCalendarRegistration);
const register = jest.mocked(api.registerForCalendar);
const cancel = jest.mocked(api.cancelCalendarRegistration);

const start: CalendarStartDetail = {
  id: ID,
  title: 'Минская сотка',
  startsOn: '2027-06-14',
  endsOn: null,
  startTime: '08:00',
  discipline: 'road',
  city: 'Минск',
  distancesKm: [100, 60],
  registrationUrl: 'https://example.by/registration',
  phase: 'upcoming',
  place: 'площадь Независимости',
  description: null,
};

const ticketing = (patch: Partial<Extract<EventTicketingPublic, { enabled: true }>> = {}) => ({
  enabled: true as const,
  startsAt: '2027-06-14T05:00:00.000Z',
  endsAt: null,
  place: 'площадь Независимости',
  address: null,
  capacity: 200,
  seatsLeft: 12,
  registrationOpen: true,
  distancesKm: [100, 60],
  ...patch,
});

const none: CalendarRegistrationState = { registration: null, ticket: null };
const registered = (distanceKm: number | null = 100): CalendarRegistrationState => ({
  registration: {
    id: '0190a6f4-0000-7000-8000-0000000000f1',
    status: 'active',
    distanceKm,
    createdAt: '2027-06-01T10:00:00.000Z',
  },
  ticket: {
    code: 'ABCDE12345',
    status: 'active',
    past: false,
    event: {
      kind: 'calendar',
      id: ID,
      title: start.title,
      startsAt: '2027-06-14T05:00:00.000Z',
      endsAt: null,
      place: null,
      address: null,
      city: 'Минск',
    },
  },
});

const conflict = (code: string, details?: unknown) =>
  new ApiHttpError(409, { code, message: code, details });

const open = () =>
  renderRouter(
    {
      'calendar/[id]': CalendarStartRoute,
      'tickets/[code]': TicketRoute,
      'sign-in': () => null,
      index: () => null,
    },
    { initialUrl: `/calendar/${ID}`, wrapper: createQueryWrapper() },
  );
const block = async () => within(await screen.findByTestId('calendar-registration'));
const signIn = () => useSessionStore.setState({ status: 'signedIn', session: liveSession });
const guest = () => useSessionStore.setState({ status: 'signedOut', session: null });

beforeEach(() => {
  jest.mocked(api.getCalendarStart).mockResolvedValue(start);
  getTicketing.mockResolvedValue(ticketing());
  getRegistration.mockResolvedValue(none);
  jest.mocked(openExternalUrl).mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

describe('регистрация на старт календаря (event-tickets §5.7, RC-B7)', () => {
  it('билеты не включены — прежняя кнопка сайта организатора', async () => {
    guest();
    getTicketing.mockResolvedValue({ enabled: false });
    await open();
    expect(
      await screen.findByRole('button', { name: 'Регистрация у организатора' }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('calendar-registration')).toBeNull();
  });

  it('ошибка сводки — деградация к внешней кнопке без баннера', async () => {
    guest();
    getTicketing.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await open();
    expect(
      await screen.findByRole('button', { name: 'Регистрация у организатора' }),
    ).toBeOnTheScreen();
    expect(getTicketing).toHaveBeenCalledWith('calendar', ID);
  });

  it('включены: места, без внешней кнопки; гость → вход с возвратом к старту', async () => {
    guest();
    const remember = jest.spyOn(returnPath, 'rememberReturnPath');
    const router = await open();
    const registration = await block();

    expect(registration.getByText('Осталось мест: 12 из 200')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Регистрация у организатора' })).toBeNull();
    expect(registration.getByText('Войдите, чтобы зарегистрироваться')).toBeOnTheScreen();
    await fireEvent.press(registration.getByRole('button', { name: 'Зарегистрироваться' }));
    expect(remember).toHaveBeenCalledWith(`/calendar/${ID}`);
    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'));
    expect(register).not.toHaveBeenCalled();
    remember.mockRestore();
  });

  it('дистанций больше одной — выбор обязателен; регистрация с выбранной', async () => {
    signIn();
    register.mockResolvedValue(registered(60));
    await open();
    const registration = await block();
    const submit = await registration.findByRole('button', { name: 'Зарегистрироваться' });

    expect(submit).toBeDisabled();
    await fireEvent.press(registration.getByText('60 км'));
    expect(submit).toBeEnabled();
    await fireEvent.press(submit);

    expect(register).toHaveBeenCalledWith(TOKEN, ID, { distanceKm: 60 });
    expect(await screen.findByText('Вы зарегистрированы · 60 км')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Открыть билет' })).toBeOnTheScreen();
    // сводка мест перезапрошена после регистрации — в обход HTTP-кэша (max-age=60)
    await waitFor(() => expect(getTicketing).toHaveBeenCalledWith('calendar', ID, { fresh: true }));
  });

  it('одна дистанция — подставляется без выбора; без дистанций — пустое тело', async () => {
    signIn();
    getTicketing.mockResolvedValue(ticketing({ distancesKm: [100] }));
    register.mockResolvedValue(registered(100));
    await open();
    await fireEvent.press(
      await (await block()).findByRole('button', { name: 'Зарегистрироваться' }),
    );
    expect(register).toHaveBeenCalledWith(TOKEN, ID, { distanceKm: 100 });
    expect(screen.queryByTestId('distance-picker')).toBeNull();
  });

  it('EVENT_FULL — текст и перезапрос сводки', async () => {
    signIn();
    getTicketing.mockResolvedValueOnce(ticketing({ distancesKm: [] }));
    getTicketing.mockResolvedValue(ticketing({ distancesKm: [], seatsLeft: 0 }));
    register.mockRejectedValue(conflict('EVENT_FULL'));
    await open();
    await fireEvent.press(
      await (await block()).findByRole('button', { name: 'Зарегистрироваться' }),
    );

    expect(register).toHaveBeenCalledWith(TOKEN, ID, {});
    expect(await screen.findByText('Мест больше нет.')).toBeOnTheScreen();
    expect(await screen.findByText('Мест нет')).toBeOnTheScreen();
    expect(getTicketing).toHaveBeenLastCalledWith('calendar', ID, { fresh: true });
  });

  it('регистрация закрыта (сервер) — «Регистрация закрыта», без кнопки', async () => {
    signIn();
    getTicketing.mockResolvedValue(ticketing({ registrationOpen: false }));
    await open();
    expect(await (await block()).findByText('Регистрация закрыта')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Зарегистрироваться' })).toBeNull();
  });

  it('зарегистрирован: «Открыть билет» ведёт на билет; отмена — с подтверждением', async () => {
    signIn();
    getRegistration.mockResolvedValue(registered());
    cancel.mockResolvedValue(none);
    jest.mocked(api.getTicket).mockReturnValue(new Promise(() => undefined));
    await open();

    expect(await screen.findByText('Вы зарегистрированы · 100 км')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить регистрацию' }));
    expect(screen.getByRole('header', { name: 'Отменить регистрацию?' })).toBeOnTheScreen();
    expect(cancel).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить регистрацию' }));

    expect(cancel).toHaveBeenCalledWith(TOKEN, ID);
    expect(await screen.findByRole('button', { name: 'Зарегистрироваться' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Открыть билет' })).toBeNull();
    // офлайн-копия отменённого билета с QR стирается
    expect(removeOfflineTicket).toHaveBeenCalledWith('ABCDE12345');
  });

  it('«Открыть билет» → /tickets/<код>', async () => {
    signIn();
    getRegistration.mockResolvedValue(registered());
    jest.mocked(api.getTicket).mockReturnValue(new Promise(() => undefined));
    const router = await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Открыть билет' }));
    await waitFor(() => expect(router.getPathname()).toBe('/tickets/ABCDE12345'));
  });

  it('регистрация закрыта после старта — отмены нет', async () => {
    signIn();
    getTicketing.mockResolvedValue(ticketing({ registrationOpen: false }));
    getRegistration.mockResolvedValue(registered());
    await open();
    expect(await screen.findByText('Вы зарегистрированы · 100 км')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отменить регистрацию' })).toBeNull();
  });

  it('закрыто по причине сервера при отправке — текст причины', async () => {
    signIn();
    getTicketing.mockResolvedValue(ticketing({ distancesKm: [] }));
    register.mockRejectedValue(conflict('EVENT_REGISTRATION_CLOSED', { reason: 'started' }));
    await open();
    await fireEvent.press(
      await (await block()).findByRole('button', { name: 'Зарегистрироваться' }),
    );
    expect(await screen.findByText('Регистрация закрыта: старт уже начался.')).toBeOnTheScreen();
  });

  it('ошибка обновления своей регистрации при показанных данных — данные и баннер с повтором', async () => {
    signIn();
    getRegistration.mockResolvedValueOnce(registered());
    getRegistration.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    getRegistration.mockResolvedValue(registered());
    const client = createTestQueryClient();
    await renderRouter(
      { 'calendar/[id]': CalendarStartRoute, index: () => null },
      { initialUrl: `/calendar/${ID}`, wrapper: createQueryWrapper(client) },
    );
    expect(await screen.findByText('Вы зарегистрированы · 100 км')).toBeOnTheScreen();

    await act(() => client.refetchQueries({ queryKey: ['calendar', 'registration', ID] }));
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByText('Вы зарегистрированы · 100 км')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Не удалось загрузить')).toBeNull());
    expect(getRegistration).toHaveBeenCalledTimes(3);
  });

  it('ошибка обновления сводки при показанных данных — блок остаётся, баннер с повтором в обход кэша', async () => {
    guest();
    getTicketing.mockResolvedValueOnce(ticketing());
    getTicketing.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    getTicketing.mockResolvedValue(ticketing({ seatsLeft: 3 }));
    const client = createTestQueryClient();
    await renderRouter(
      { 'calendar/[id]': CalendarStartRoute, index: () => null },
      { initialUrl: `/calendar/${ID}`, wrapper: createQueryWrapper(client) },
    );
    expect(await screen.findByText('Осталось мест: 12 из 200')).toBeOnTheScreen();

    await act(() => client.refetchQueries({ queryKey: ['calendar', 'ticketing', ID] }));
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByText('Осталось мест: 12 из 200')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Осталось мест: 3 из 200')).toBeOnTheScreen();
    expect(getTicketing).toHaveBeenLastCalledWith('calendar', ID, { fresh: true });
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });

  it('место и адрес из сводки билетов — в блоке, без дубля места карточки', async () => {
    guest();
    getTicketing.mockResolvedValue(
      ticketing({ place: 'площадь Независимости', address: 'пр. Независимости, 2' }),
    );
    await open();
    const registration = await block();
    expect(registration.getByText('пр. Независимости, 2')).toBeOnTheScreen();
    expect(registration.queryByText(/площадь Независимости/)).toBeNull();
  });

  it('место из сводки, отличное от карточки, — вместе с адресом', async () => {
    guest();
    getTicketing.mockResolvedValue(ticketing({ place: 'Стела', address: 'пр. Победителей, 1' }));
    await open();
    expect((await block()).getByText('Стела, пр. Победителей, 1')).toBeOnTheScreen();
  });
});
