/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationPage,
  type NotificationView,
} from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import NotificationsScreen from '../app/notifications';
import NotificationSettingsScreen from '../app/settings/notifications';
import ProfileScreen from '../app/settings/profile';
import { liveSession, signInForTest } from './auth-fixtures';

jest.mock('@/lib/api');

const list = jest.mocked(api.listNotifications);
const unreadCount = jest.mocked(api.getUnreadCount);
const markRead = jest.mocked(api.markNotificationRead);
const markAll = jest.mocked(api.markAllNotificationsRead);
const getSettings = jest.mocked(api.getNotificationSettings);
const updateSettings = jest.mocked(api.updateNotificationSettings);
const getProfile = jest.mocked(api.getProfile);
const getEventSettings = jest.mocked(api.getEventNotificationSettings);
const updateEventSettings = jest.mocked(api.updateEventNotificationSettings);

const RACE = '0190a6f4-0000-7000-8000-000000000001';
const never = () => new Promise<never>(() => undefined);

const notice = (overrides: Partial<NotificationView> = {}): NotificationView => ({
  id: '0190a6f4-0000-7000-8000-0000000000a1',
  kind: 'result_counted',
  group: 'races',
  title: 'Результат засчитан',
  body: '«Гравийный коридор»: заезд 14 июня засчитан.',
  createdAt: '2026-10-20T07:00:00.000Z',
  read: false,
  target: { type: 'race', raceId: RACE },
  ...overrides,
});
const page = (items: NotificationView[], nextCursor: string | null = null): NotificationPage => ({
  items,
  nextCursor,
});

let client: QueryClient;

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  list.mockResolvedValue(page([notice()]));
  unreadCount.mockResolvedValue({ count: 1 });
  markRead.mockResolvedValue(undefined);
  markAll.mockResolvedValue(undefined);
  getSettings.mockResolvedValue(DEFAULT_NOTIFICATION_SETTINGS);
  updateSettings.mockImplementation(async (_token, body) => body);
  getEventSettings.mockResolvedValue({ push: true, email: true });
  updateEventSettings.mockImplementation(async (_token, body) => body);
  getProfile.mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
    themeId: 'classic',
    avatarUploadBlockedUntil: null,
  });
});
afterEach(() => jest.clearAllMocks());

async function open(initialUrl: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderRouter(
    {
      notifications: NotificationsScreen,
      'settings/notifications': NotificationSettingsScreen,
      'settings/profile': ProfileScreen,
      'races/[id]': () => null,
      'rides/[id]': () => null,
    },
    { initialUrl, wrapper },
  );
}

const ROW = /^Результат засчитан\./;

describe('«Уведомления»: состояния (§4.12)', () => {
  it('заголовок сразу, на месте списка — скелетон', async () => {
    list.mockReturnValue(never());
    await open('/notifications');
    expect(await screen.findByRole('header', { name: 'Уведомления' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
  });

  it('список: непрочитанное выделено «Новое», время по Минску', async () => {
    await open('/notifications');
    const row = await screen.findByRole('button', { name: ROW });
    expect(row).toHaveProp(
      'accessibilityLabel',
      'Результат засчитан. «Гравийный коридор»: заезд 14 июня засчитан. Новое, 20 октября, 10:00',
    );
    expect(screen.getByText('Новое')).toBeOnTheScreen();
  });

  it('пусто — пустое состояние', async () => {
    list.mockResolvedValue(page([]));
    unreadCount.mockResolvedValue({ count: 0 });
    await open('/notifications');
    expect(await screen.findByText('Уведомлений пока нет')).toBeOnTheScreen();
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('ошибка загрузки (%s) — «%s» с повтором', async (_case, error, title) => {
    list.mockRejectedValueOnce(error);
    await open('/notifications');
    expect(await screen.findByText(title)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: ROW })).toBeOnTheScreen();
  });

  it('ошибка обновления при показанном списке — баннер, список остаётся', async () => {
    await open('/notifications');
    await screen.findByRole('button', { name: ROW });
    list.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));

    await client.refetchQueries({ queryKey: ['notifications', 'list'] });

    expect(await screen.findByText('Данные могли устареть')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: ROW })).toBeOnTheScreen();
  });

  it('следующая страница — по курсору; ошибка догрузки — баннер с повтором в подвале', async () => {
    list.mockResolvedValueOnce(page([notice()], 'cursor-2'));
    list.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await open('/notifications');
    await screen.findByRole('button', { name: ROW });

    await fireEvent(screen.getByTestId('notifications-screen'), 'onEndReached');

    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(list).toHaveBeenLastCalledWith(liveSession.accessToken, {
      limit: 20,
      cursor: 'cursor-2',
    });
  });
});

describe('«Уведомления»: нажатие и «Прочитать все» (N9, N10)', () => {
  it('нажатие — прочитано и переход к цели из белого списка', async () => {
    const router = await open('/notifications');
    await fireEvent.press(await screen.findByRole('button', { name: ROW }));

    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE}`));
    expect(markRead).toHaveBeenCalledWith(liveSession.accessToken, notice().id);
  });

  it.each([
    ['незнакомая цель', { type: 'unknown' as const }],
    ['без цели', null],
  ])('%s — прочитано, без перехода', async (_case, target) => {
    list.mockResolvedValue(page([notice({ target })]));
    const router = await open('/notifications');
    await fireEvent.press(await screen.findByRole('button', { name: ROW }));

    await waitFor(() => expect(markRead).toHaveBeenCalled());
    expect(router.getPathname()).toBe('/notifications');
  });

  it('прочитанное — без повторного запроса прочтения', async () => {
    list.mockResolvedValue(page([notice({ read: true })]));
    unreadCount.mockResolvedValue({ count: 0 });
    const router = await open('/notifications');
    await fireEvent.press(await screen.findByRole('button', { name: ROW }));

    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE}`));
    expect(markRead).not.toHaveBeenCalled();
  });

  it('«Прочитать все» — запрос и обновление списка и счётчика', async () => {
    await open('/notifications');
    await screen.findByRole('button', { name: ROW });
    list.mockResolvedValue(page([notice({ read: true })]));
    unreadCount.mockResolvedValue({ count: 0 });

    await fireEvent.press(screen.getByRole('button', { name: 'Прочитать все' }));

    expect(markAll).toHaveBeenCalledWith(liveSession.accessToken);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Прочитать все' })).toBeDisabled(),
    );
    expect(screen.queryByText('Новое')).toBeNull();
  });

  it('нет непрочитанных — «Прочитать все» недоступна', async () => {
    list.mockResolvedValue(page([notice({ read: true })]));
    unreadCount.mockResolvedValue({ count: 0 });
    await open('/notifications');
    await screen.findByRole('button', { name: ROW });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Прочитать все' })).toBeDisabled(),
    );
  });

  it('«Прочитать все» не удалось — баннер ошибки', async () => {
    markAll.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await open('/notifications');
    await screen.findByRole('button', { name: ROW });

    await fireEvent.press(screen.getByRole('button', { name: 'Прочитать все' }));

    expect(
      await screen.findByText('Не удалось отметить уведомления. Повторите.'),
    ).toBeOnTheScreen();
  });

  it('вход в настройки', async () => {
    const router = await open('/notifications');
    await fireEvent.press(await screen.findByRole('button', { name: 'Настройки уведомлений' }));
    await waitFor(() => expect(router.getPathname()).toBe('/settings/notifications'));
  });
});

describe('«Уведомления»: строка push (N5, native)', () => {
  it('разрешения нет — строка; нажатие — системный запрос и регистрация', async () => {
    await open('/notifications');
    const row = await screen.findByRole('button', { name: /Включить push-уведомления/ });

    await fireEvent.press(row);

    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Включить push-уведомления/ })).toBeNull(),
    );
  });

  it('разрешение уже есть — строки нет, запроса при открытии нет', async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValueOnce({ status: 'granted', canAskAgain: true } as never);
    await open('/notifications');
    await screen.findByRole('button', { name: ROW });
    expect(screen.queryByRole('button', { name: /Включить push-уведомления/ })).toBeNull();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('отказ навсегда — строка ведёт в настройки устройства', async () => {
    jest
      .mocked(Notifications.getPermissionsAsync)
      .mockResolvedValueOnce({ status: 'denied', canAskAgain: false } as never);
    await open('/notifications');
    expect(
      await screen.findByText(
        'Push-уведомления запрещены. Нажмите, чтобы открыть настройки устройства.',
      ),
    ).toBeOnTheScreen();
  });
});

describe('«Настройки уведомлений» (N4, N6)', () => {
  it('группы × push, e-mail — у «Споры», «Райды» и «Мероприятия»', async () => {
    await open('/settings/notifications');
    expect(await screen.findByRole('header', { name: 'Мероприятия' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Гонки и результаты' })).toBeOnTheScreen();
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })).toHaveLength(4);
    expect(screen.getAllByRole('switch', { name: 'Письма на e-mail' })).toHaveLength(3);
    expect(screen.getByText('Только напоминания о событиях с билетом.')).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Не присылать push ночью' })).toBeChecked();
  });

  it('тумблер сохраняет полный объект настроек', async () => {
    await open('/settings/notifications');
    const [racesPush] = await screen.findAllByRole('switch', { name: 'Push-уведомления' });

    await fireEvent.press(racesPush!);

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(liveSession.accessToken, {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        push: { ...DEFAULT_NOTIFICATION_SETTINGS.push, races: false },
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[0]).not.toBeChecked(),
    );
  });

  it('тихие часы: начало по часам; час конца среди вариантов начала нет', async () => {
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Начало' });
    // 22–8: в ряду начала нет 8:00, в ряду конца — 22:00 (начало ≠ концу)
    expect(screen.getAllByRole('button', { name: '8:00' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '22:00' })).toHaveLength(1);

    await fireEvent.press(screen.getAllByRole('button', { name: '23:00' })[0]!);

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(liveSession.accessToken, {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        quietHours: { enabled: true, startHour: 23, endHour: 8 },
      }),
    );
  });

  it('выключенные тихие часы — без выбора часов', async () => {
    getSettings.mockResolvedValue({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      quietHours: { enabled: false, startHour: 22, endHour: 8 },
    });
    await open('/settings/notifications');
    expect(
      await screen.findByRole('switch', { name: 'Не присылать push ночью' }),
    ).not.toBeChecked();
    expect(screen.queryByRole('header', { name: 'Начало' })).toBeNull();
  });

  it('пока идёт сохранение, тумблеры и часы недоступны — второе изменение не уходит (§4.12)', async () => {
    updateSettings.mockImplementation(never);
    await open('/settings/notifications');
    const [racesPush] = await screen.findAllByRole('switch', { name: 'Push-уведомления' });

    await fireEvent.press(racesPush!);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[0]).not.toBeChecked(),
    );
    // «Мероприятия» — свой подресурс и своё сохранение: блокируются только тумблеры основного объекта
    const switches = screen.getAllByRole('switch');
    const disabled = switches.filter((toggle) => toggle.props.accessibilityState?.disabled);
    expect(disabled).toHaveLength(switches.length - 2);
    const [hour] = screen.getAllByRole('button', { name: '23:00' });
    expect(hour).toBeDisabled();
    await fireEvent.press(screen.getAllByRole('switch', { name: 'Письма на e-mail' })[0]!);
    await fireEvent.press(hour!);
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it('ошибка сохранения — баннер и прежнее значение', async () => {
    updateSettings.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await open('/settings/notifications');
    const [racesPush] = await screen.findAllByRole('switch', { name: 'Push-уведомления' });

    await fireEvent.press(racesPush!);

    expect(await screen.findByText('Не удалось сохранить настройки. Повторите.')).toBeOnTheScreen();
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[0]).toBeChecked();
  });

  it('ошибка загрузки — «Нет соединения» с повтором', async () => {
    getEventSettings.mockImplementation(never);
    getSettings.mockRejectedValueOnce(new ApiNetworkError(new TypeError('Network request failed')));
    await open('/settings/notifications');
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('header', { name: 'Споры' })).toBeOnTheScreen();
  });

  it('«Мероприятия»: тумблер сохраняет подресурс, основные настройки не трогает (RC-D1)', async () => {
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Мероприятия' });
    const pushes = screen.getAllByRole('switch', { name: 'Push-уведомления' });

    await fireEvent.press(pushes[3]!);

    await waitFor(() =>
      expect(updateEventSettings).toHaveBeenCalledWith(liveSession.accessToken, {
        push: false,
        email: true,
      }),
    );
    expect(updateSettings).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[3]).not.toBeChecked(),
    );
  });

  it('«Мероприятия»: старый API (404) — группы нет', async () => {
    getEventSettings.mockRejectedValueOnce(
      new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }),
    );
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Райды' });
    await waitFor(() => expect(getEventSettings).toHaveBeenCalled());
    expect(screen.queryByRole('header', { name: 'Мероприятия' })).toBeNull();
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })).toHaveLength(3);
  });

  it('«Мероприятия»: ошибка сохранения — баннер и прежнее значение', async () => {
    updateEventSettings.mockRejectedValue(
      new ApiNetworkError(new TypeError('Network request failed')),
    );
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Мероприятия' });
    await fireEvent.press(screen.getAllByRole('switch', { name: 'Письма на e-mail' })[2]!);
    expect(await screen.findByText('Не удалось сохранить настройки. Повторите.')).toBeOnTheScreen();
    expect(screen.getAllByRole('switch', { name: 'Письма на e-mail' })[2]).toBeChecked();
  });

  it('вход из «Профиля»', async () => {
    const router = await open('/settings/profile');
    await fireEvent.press(await screen.findByRole('button', { name: 'Уведомления' }));
    await waitFor(() => expect(router.getPathname()).toBe('/settings/notifications'));
  });
});
