/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { EventMaterial } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import * as returnPath from '@/features/auth/return-path';
import { useSessionStore } from '@/features/auth/session-store';
import { calendarTicket, QR, raceTicket, TICKET_CODE } from '@/features/tickets/fixtures';
import {
  clearOfflineTickets,
  readOfflineTicket,
  removeOfflineTicket,
  saveOfflineTicket,
} from '@/features/tickets/offline-store';
import { api } from '@/lib/api';
import { openExternalUrl } from '@/lib/open-external-url';

import CalendarStartRoute from '../app/calendar/[id]';
import RaceRoute from '../app/races/[id]';
import TicketRoute from '../app/tickets/[code]';
import { appRoutes } from './app-routes';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';
import { EMAIL, liveSession, session, storeSession, storeSurveyCompleted } from './auth-fixtures';
import { USER_A } from './jwt';

jest.mock('@/lib/api');
jest.mock('@/lib/open-external-url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/features/tickets/offline-store', () => ({
  saveOfflineTicket: jest.fn(async () => undefined),
  readOfflineTicket: jest.fn(async () => null),
  removeOfflineTicket: jest.fn(async () => undefined),
  clearOfflineTickets: jest.fn(async () => undefined),
}));

const getTicket = jest.mocked(api.getTicket);
const readCopy = jest.mocked(readOfflineTicket);
const PATH = `/tickets/${TICKET_CODE}`;
const ticketMaterial: EventMaterial = {
  id: '0190a6f4-0000-7000-8000-0000000000f4',
  type: 'what_to_bring',
  title: 'Что взять с собой',
  description: 'Шлем, номер, вода',
  url: 'https://example.by/kit',
  file: null,
};
const SAVED_AT = Date.parse('2027-06-10T09:30:00Z');

beforeEach(() => {
  // материалы события (event-tickets PR C): по умолчанию у события их нет — блока нет
  jest.mocked(api.getEventMaterials).mockResolvedValue([]);
  jest.mocked(api.refreshSession).mockResolvedValue(liveSession);
  jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' });
  jest.mocked(api.signOut).mockResolvedValue(undefined);
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRides).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listTickets).mockResolvedValue({ upcoming: [], past: [] });
  jest.mocked(api.getProfile).mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
    themeId: 'classic',
    avatarUploadBlockedUntil: null,
    showRouteRides: false,
  });
  jest.mocked(openExternalUrl).mockResolvedValue(undefined);
  readCopy.mockResolvedValue(null);
});
afterEach(() => jest.clearAllMocks());

/** Вошедший: экран и карточки без корневого layout (клиент запросов без повторов — ошибка видна сразу). */
async function openSignedIn(url = PATH) {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  return renderRouter(
    {
      'tickets/[code]': TicketRoute,
      'races/[id]': RaceRoute,
      'calendar/[id]': CalendarStartRoute,
      index: () => null,
    },
    { initialUrl: url, wrapper: createQueryWrapper() },
  );
}

describe('экран билета /tickets/<код> (AC12, §5.7)', () => {
  it('скелетон → билет: событие, статус, дата (Минск), место, участник, группа, QR, код, инструкции', async () => {
    let resolve: (view: typeof raceTicket) => void = () => undefined;
    getTicket.mockReturnValue(new Promise((done) => (resolve = done)));
    await openSignedIn();

    expect(
      await screen.findByTestId('ticket-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    resolve(raceTicket);

    expect(await screen.findByRole('header', { name: raceTicket.event.title })).toBeOnTheScreen();
    expect(getTicket).toHaveBeenCalledWith(liveSession.accessToken, TICKET_CODE);
    expect(screen.getByText('Гонка')).toBeOnTheScreen();
    expect(screen.getByText('Активен')).toBeOnTheScreen();
    expect(screen.getByText('Понедельник, 14 июня 2027, 8:00–14:00')).toBeOnTheScreen();
    expect(screen.getByText('Стела')).toBeOnTheScreen();
    expect(screen.getByText('пр. Победителей, 1, Минск')).toBeOnTheScreen();
    expect(screen.getByText('Иван К.')).toBeOnTheScreen();
    expect(screen.getByText('Verified · Мужчины до 40')).toBeOnTheScreen();
    expect(await screen.findByRole('image', { name: 'QR-код билета' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Код билета: A B C D E 1 2 3 4 5')).toHaveTextContent(
      'ABCDE-12345',
    );
    expect(screen.getByText(raceTicket.instructions!)).toBeOnTheScreen();
    // копия — владельцу сессии
    expect(saveOfflineTicket).toHaveBeenCalledWith(USER_A, raceTicket);
  });

  it('QR нет (событие прошло) — пояснение вместо QR, код остаётся', async () => {
    getTicket.mockResolvedValue({ ...raceTicket, past: true, qr: null });
    await openSignedIn();

    expect(await screen.findByText('QR недоступен: событие завершено.')).toBeOnTheScreen();
    expect(screen.getByText('Событие завершено')).toBeOnTheScreen();
    expect(screen.queryByRole('image', { name: 'QR-код билета' })).toBeNull();
    expect(screen.getByText('ABCDE-12345')).toBeOnTheScreen();
  });

  it.each([
    ['cancelled', 'Отменён', 'QR недоступен: билет отменён.'],
    ['event_cancelled', 'Событие отменено', 'QR недоступен: событие отменено.'],
  ] as const)('статус %s — плашка и пояснение', async (status, pill, hint) => {
    getTicket.mockResolvedValue({ ...raceTicket, status, qr: null });
    await openSignedIn();
    expect(await screen.findByText(pill)).toBeOnTheScreen();
    expect(screen.getByText(hint)).toBeOnTheScreen();
  });

  it('отмечен — время отметки по Минску', async () => {
    getTicket.mockResolvedValue({
      ...raceTicket,
      status: 'checked_in',
      qr: null,
      checkedInAt: '2027-06-14T04:42:00.000Z',
    });
    await openSignedIn();
    expect(await screen.findByText('Отмечен Пн 14 июня 2027, 7:42')).toBeOnTheScreen();
  });

  it('старт календаря: дистанция, без адреса — без «Как добраться»', async () => {
    getTicket.mockResolvedValue({
      ...calendarTicket,
      event: { ...calendarTicket.event, city: null },
    });
    await openSignedIn(`/tickets/${calendarTicket.code}`);
    expect(await screen.findByText('Старт календаря')).toBeOnTheScreen();
    expect(screen.getByText('100 км')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Как добраться' })).toBeNull();
    expect(screen.getByRole('button', { name: 'О событии' })).toBeOnTheScreen();
  });

  it('«Как добраться» — системные карты по адресу (jest native — iOS: Apple Maps); «О событии» — карточка', async () => {
    getTicket.mockResolvedValue(raceTicket);
    const router = await openSignedIn();
    await fireEvent.press(await screen.findByRole('button', { name: 'Как добраться' }));
    expect(openExternalUrl).toHaveBeenCalledWith(
      `https://maps.apple.com/?q=${encodeURIComponent('пр. Победителей, 1, Минск')}`,
    );
    jest.mocked(api.getRace).mockReturnValue(new Promise(() => undefined));
    jest.mocked(api.getMyRaceEntry).mockReturnValue(new Promise(() => undefined));
    await fireEvent.press(screen.getByRole('button', { name: 'О событии' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${raceTicket.event.id}`));
  });

  it('404 (чужой или несуществующий) — «Билет не найден», копия кода стирается', async () => {
    getTicket.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await openSignedIn();
    expect(await screen.findByText('Билет не найден')).toBeOnTheScreen();
    expect(removeOfflineTicket).toHaveBeenCalledWith(TICKET_CODE);
  });

  it('обновление после показа вернуло 404 — билет и QR скрываются, «Билет не найден»', async () => {
    getTicket.mockResolvedValueOnce(raceTicket);
    getTicket.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    const client = createTestQueryClient();
    useSessionStore.setState({ status: 'signedIn', session: liveSession });
    await renderRouter(
      { 'tickets/[code]': TicketRoute, index: () => null },
      { initialUrl: PATH, wrapper: createQueryWrapper(client) },
    );
    expect(await screen.findByRole('image', { name: 'QR-код билета' })).toBeOnTheScreen();

    await act(() => client.refetchQueries({ queryKey: ['tickets', 'detail', TICKET_CODE] }));
    expect(await screen.findByText('Билет не найден')).toBeOnTheScreen();
    expect(screen.queryByRole('image', { name: 'QR-код билета' })).toBeNull();
    expect(removeOfflineTicket).toHaveBeenCalledWith(TICKET_CODE);
  });

  it('успех → 404 → сеть: билет не возвращается до следующего успешного ответа', async () => {
    getTicket.mockResolvedValueOnce(raceTicket);
    getTicket.mockRejectedValueOnce(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    getTicket.mockRejectedValueOnce(new ApiNetworkError(new Error('offline')));
    const client = createTestQueryClient();
    useSessionStore.setState({ status: 'signedIn', session: liveSession });
    await renderRouter(
      { 'tickets/[code]': TicketRoute, index: () => null },
      { initialUrl: PATH, wrapper: createQueryWrapper(client) },
    );
    await screen.findByRole('image', { name: 'QR-код билета' });
    const refetch = () =>
      act(() => client.refetchQueries({ queryKey: ['tickets', 'detail', TICKET_CODE] }));

    await refetch();
    expect(await screen.findByText('Билет не найден')).toBeOnTheScreen();
    await refetch();
    expect(getTicket).toHaveBeenCalledTimes(3);
    // уведомления Query приходят после act — ждём: билет с QR не должен вернуться
    await expect(screen.findByRole('image', { name: 'QR-код билета' })).rejects.toThrow();
    expect(screen.getByText('Билет не найден')).toBeOnTheScreen();

    getTicket.mockResolvedValue(raceTicket);
    await refetch();
    expect(await screen.findByRole('image', { name: 'QR-код билета' })).toBeOnTheScreen();
  });

  it('копия → 404 → сеть: копия больше не показывается', async () => {
    readCopy.mockResolvedValue({ view: raceTicket, savedAt: SAVED_AT });
    getTicket.mockRejectedValueOnce(new ApiNetworkError(new Error('offline')));
    getTicket.mockRejectedValueOnce(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    getTicket.mockRejectedValueOnce(new ApiNetworkError(new Error('offline')));
    const client = createTestQueryClient();
    useSessionStore.setState({ status: 'signedIn', session: liveSession });
    await renderRouter(
      { 'tickets/[code]': TicketRoute, index: () => null },
      { initialUrl: PATH, wrapper: createQueryWrapper(client) },
    );
    expect(await screen.findByTestId('ticket-offline-copy')).toBeOnTheScreen();
    const refetch = () =>
      act(() => client.refetchQueries({ queryKey: ['tickets', 'detail', TICKET_CODE] }));

    await refetch();
    expect(await screen.findByText('Билет не найден')).toBeOnTheScreen();
    await refetch();
    expect(getTicket).toHaveBeenCalledTimes(3);
    await expect(screen.findByTestId('ticket-offline-copy')).rejects.toThrow();
    expect(screen.getByText('Билет не найден')).toBeOnTheScreen();
  });

  it('адрес не код билета — «не найдено» без запроса', async () => {
    await openSignedIn('/tickets/not-a-code!');
    expect(await screen.findByText('Билет не найден')).toBeOnTheScreen();
    expect(getTicket).not.toHaveBeenCalled();
  });

  it('код в адресе с дефисом и строчными — запрос каноническим кодом', async () => {
    getTicket.mockResolvedValue(raceTicket);
    await openSignedIn('/tickets/abcde-12345');
    expect(await screen.findByRole('header', { name: raceTicket.event.title })).toBeOnTheScreen();
    expect(getTicket).toHaveBeenCalledWith(liveSession.accessToken, TICKET_CODE);
  });

  it('сеть без данных + копия — «Офлайн-копия от …», билет с QR; повтор', async () => {
    getTicket.mockRejectedValue(new ApiNetworkError(new Error('offline')));
    readCopy.mockResolvedValue({ view: raceTicket, savedAt: SAVED_AT });
    await openSignedIn();

    expect(
      await screen.findByText('Офлайн-копия от Чт 10 июня 2027, 12:30. Статус мог измениться.'),
    ).toBeOnTheScreen();
    expect(readCopy).toHaveBeenCalledWith(USER_A, TICKET_CODE);
    expect(screen.getByRole('header', { name: raceTicket.event.title })).toBeOnTheScreen();
    expect(await screen.findByRole('image', { name: 'QR-код билета' })).toBeOnTheScreen();

    getTicket.mockResolvedValue(raceTicket);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByTestId('ticket-offline-copy')).toBeNull());
  });

  it('материалы события (PR C): из TicketView без отдельного запроса; ссылка — браузер', async () => {
    getTicket.mockResolvedValue({ ...raceTicket, materials: [ticketMaterial] });
    await openSignedIn();

    const row = await screen.findByRole('link', {
      name: 'Что взять с собой. Шлем, номер, вода. example.by',
    });
    expect(screen.getByText('Материалы')).toBeOnTheScreen();
    expect(api.getEventMaterials).not.toHaveBeenCalled();
    await fireEvent.press(row);
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.by/kit');
  });

  it('старый сервер (до PR C) поля materials не шлёт — блока нет', async () => {
    getTicket.mockResolvedValue(raceTicket);
    await openSignedIn();
    await screen.findByRole('header', { name: raceTicket.event.title });
    expect(screen.queryByTestId('event-materials')).toBeNull();
  });

  it('офлайн-копия билета показывает сохранённые материалы', async () => {
    getTicket.mockRejectedValue(new ApiNetworkError(new Error('offline')));
    readCopy.mockResolvedValue({
      view: { ...raceTicket, materials: [ticketMaterial] },
      savedAt: SAVED_AT,
    });
    await openSignedIn();

    expect(await screen.findByTestId('ticket-offline-copy')).toBeOnTheScreen();
    expect(
      screen.getByRole('link', { name: 'Что взять с собой. Шлем, номер, вода. example.by' }),
    ).toBeOnTheScreen();
  });

  it('сессия не проверена (web без связи при запуске) — копия своего снимка без запроса (RC-B4)', async () => {
    readCopy.mockResolvedValue({ view: raceTicket, savedAt: SAVED_AT });
    useSessionStore.setState({
      status: 'unavailable',
      session: null,
      restoreError: new ApiNetworkError(new Error('offline')),
    });
    await renderRouter(
      { 'tickets/[code]': TicketRoute },
      {
        initialUrl: PATH,
        wrapper: createQueryWrapper(),
      },
    );

    expect(await screen.findByTestId('ticket-offline-copy')).toBeOnTheScreen();
    expect(readCopy).toHaveBeenCalledWith(null, TICKET_CODE);
    expect(getTicket).not.toHaveBeenCalled();
  });

  it('сессия не проверена и копии нет — «Нет соединения» с повтором восстановления', async () => {
    useSessionStore.setState({
      status: 'unavailable',
      session: null,
      restoreError: new ApiNetworkError(new Error('offline')),
    });
    await renderRouter(
      { 'tickets/[code]': TicketRoute },
      {
        initialUrl: PATH,
        wrapper: createQueryWrapper(),
      },
    );
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.queryByTestId('ticket-offline-copy')).toBeNull();
  });

  it('сеть без данных и без копии — «Нет соединения» с повтором', async () => {
    getTicket.mockRejectedValue(new ApiNetworkError(new Error('offline')));
    await openSignedIn();
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
  });

  it('5xx без данных — копия, если есть; без копии — «Не удалось загрузить»', async () => {
    getTicket.mockRejectedValue(new ApiHttpError(503, { code: 'INTERNAL', message: 'x' }));
    await openSignedIn();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
  });

  it('гость — путь билета запомнен, «Вход»; после входа — билет', async () => {
    const remember = jest.spyOn(returnPath, 'rememberReturnPath');
    storeSurveyCompleted();
    jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session });
    getTicket.mockResolvedValue(raceTicket);
    const router = await renderRouter(appRoutes, { initialUrl: PATH });

    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(remember).toHaveBeenCalledWith(PATH);
    expect(getTicket).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(router.getPathname()).toBe(PATH));
    expect(await screen.findByRole('header', { name: raceTicket.event.title })).toBeOnTheScreen();
    remember.mockRestore();
  });

  it.each([
    [
      'опрос не пройден',
      () => jest.mocked(api.getOnboardingStatus).mockResolvedValue({ surveyCompleted: false }),
    ],
    [
      'статус онбординга не загрузился',
      () =>
        jest
          .mocked(api.getOnboardingStatus)
          .mockRejectedValue(new ApiHttpError(503, { code: 'INTERNAL', message: 'x' })),
    ],
  ])(
    'гость с незавершённым онбордингом (%s) — после входа сразу билет (RC-B1)',
    async (_name, arrange) => {
      arrange();
      jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session });
      getTicket.mockResolvedValue(raceTicket);
      const router = await renderRouter(appRoutes, { initialUrl: PATH });

      expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
      await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
      await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

      await waitFor(() => expect(router.getPathname()).toBe(PATH));
      expect(await screen.findByRole('header', { name: raceTicket.event.title })).toBeOnTheScreen();
    },
  );

  it('выход из аккаунта (корневой layout) стирает офлайн-копии билетов', async () => {
    getTicket.mockResolvedValue(raceTicket);
    storeSession(liveSession);
    storeSurveyCompleted();
    await renderRouter(appRoutes, { initialUrl: PATH });
    await screen.findByRole('header', { name: raceTicket.event.title });
    jest.mocked(clearOfflineTickets).mockClear();

    await useSessionStore.getState().signOut();
    await waitFor(() => expect(clearOfflineTickets).toHaveBeenCalled());
  });

  it('QR не в подписях a11y и не в тексте экрана', async () => {
    getTicket.mockResolvedValue(raceTicket);
    await openSignedIn();
    await screen.findByRole('image', { name: 'QR-код билета' });
    expect(screen.queryByText(new RegExp(QR.slice(5, 15)))).toBeNull();
    expect(screen.queryByLabelText(new RegExp(QR.slice(5, 15)))).toBeNull();
  });
});
