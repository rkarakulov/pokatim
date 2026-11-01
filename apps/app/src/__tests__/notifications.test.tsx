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
const getRouteSettings = jest.mocked(api.getRouteNotificationSettings);
const updateRouteSettings = jest.mocked(api.updateRouteNotificationSettings);
const getAchievementSettings = jest.mocked(api.getAchievementNotificationSettings);
const updateAchievementSettings = jest.mocked(api.updateAchievementNotificationSettings);
const getSocialSettings = jest.mocked(api.getSocialNotificationSettings);
const updateSocialSettings = jest.mocked(api.updateSocialNotificationSettings);

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
  getRouteSettings.mockResolvedValue({ push: true });
  updateRouteSettings.mockImplementation(async (_token, body) => body);
  getAchievementSettings.mockResolvedValue({ push: true });
  updateAchievementSettings.mockImplementation(async (_token, body) => body);
  getSocialSettings.mockResolvedValue({ push: true });
  updateSocialSettings.mockImplementation(async (_token, body) => body);
  getProfile.mockResolvedValue({
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
      'achievements/[code]': () => null,
      'riders/[id]': () => null,
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

  it('новое достижение — переход на экран достижения (сезонное — с сезоном)', async () => {
    list.mockResolvedValue(
      page([
        notice({
          kind: 'achievement_granted',
          group: 'achievements',
          title: 'Новое достижение: Чемпион сезона',
          body: 'Сезон «Сезон 2026»',
          target: { type: 'achievement', code: 'season_champion', seasonId: RACE },
        }),
      ]),
    );
    const router = await open('/notifications');
    await fireEvent.press(
      await screen.findByRole('button', { name: /^Новое достижение: Чемпион сезона\./ }),
    );
    await waitFor(() => expect(router.getPathname()).toBe('/achievements/season_champion'));
    expect(router.getSearchParams()).toMatchObject({ season: RACE });
  });

  it('фото райда удалено модератором (ride_photo_reset) — текст сервера, переход в карточку райда', async () => {
    const rideId = '0190a6f4-0000-7000-8000-000000000005';
    list.mockResolvedValue(
      page([
        notice({
          kind: 'ride_photo_reset',
          group: 'rides',
          title: 'Фото райда удалено',
          body: 'Модератор удалил фото райда «Кофе-райд». Можно загрузить другое, пока райд не начался.',
          target: { type: 'ride', rideId },
        }),
      ]),
    );
    const router = await open('/notifications');
    expect(
      await screen.findByText(
        'Модератор удалил фото райда «Кофе-райд». Можно загрузить другое, пока райд не начался.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /^Фото райда удалено\./ }));
    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${rideId}`));
  });

  it('«Свои»: цель rider — переход на публичный профиль', async () => {
    const publicId = 'K'.repeat(43);
    list.mockResolvedValue(
      page([
        notice({
          kind: 'social_added',
          group: 'social',
          title: 'Вас добавили в свои',
          body: 'Катя Л. и ещё 2',
          target: { type: 'rider', publicId },
        }),
      ]),
    );
    const router = await open('/notifications');
    await fireEvent.press(await screen.findByRole('button', { name: /^Вас добавили в свои\./ }));
    await waitFor(() => expect(router.getPathname()).toBe(`/riders/${publicId}`));
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
  it('группы × push, e-mail — у «Споры», «Райды» и «Мероприятия»; «Маршруты» — только push, после «Райдов»', async () => {
    await open('/settings/notifications');
    expect(await screen.findByRole('header', { name: 'Мероприятия' })).toBeOnTheScreen();
    expect(await screen.findByRole('header', { name: 'Маршруты' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Гонки и результаты' })).toBeOnTheScreen();
    const headers = screen.getAllByRole('header').map((header) => header.props.children);
    expect(headers.indexOf('Маршруты')).toBe(headers.indexOf('Райды') + 1);
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })).toHaveLength(7);
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
    // «Маршруты», «Мероприятия», «Достижения» и «Свои» — свои подресурсы и своё сохранение: блокируются только
    // тумблеры основного объекта
    const switches = screen.getAllByRole('switch');
    const disabled = switches.filter((toggle) => toggle.props.accessibilityState?.disabled);
    expect(disabled).toHaveLength(switches.length - 5);
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

    await fireEvent.press(pushes[4]!);

    await waitFor(() =>
      expect(updateEventSettings).toHaveBeenCalledWith(liveSession.accessToken, {
        push: false,
        email: true,
      }),
    );
    expect(updateSettings).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[4]).not.toBeChecked(),
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
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })).toHaveLength(6);
  });

  it('«Маршруты»: тумблер сохраняет подресурс, основные настройки не трогает', async () => {
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Маршруты' });
    const pushes = await screen.findAllByRole('switch', { name: 'Push-уведомления' });
    expect(pushes).toHaveLength(7);

    await fireEvent.press(pushes[3]!);

    await waitFor(() =>
      expect(updateRouteSettings).toHaveBeenCalledWith(liveSession.accessToken, { push: false }),
    );
    expect(updateSettings).not.toHaveBeenCalled();
    expect(updateEventSettings).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[3]).not.toBeChecked(),
    );
  });

  it('«Достижения»: только push, последней из групп; тумблер сохраняет подресурс', async () => {
    await open('/settings/notifications');
    expect(await screen.findByRole('header', { name: 'Достижения' })).toBeOnTheScreen();
    const headers = screen.getAllByRole('header').map((header) => header.props.children);
    expect(headers.indexOf('Достижения')).toBe(headers.indexOf('Мероприятия') + 1);
    const pushes = await screen.findAllByRole('switch', { name: 'Push-уведомления' });
    expect(pushes).toHaveLength(7);

    await fireEvent.press(pushes[5]!);

    await waitFor(() =>
      expect(updateAchievementSettings).toHaveBeenCalledWith(liveSession.accessToken, {
        push: false,
      }),
    );
    expect(updateSettings).not.toHaveBeenCalled();
    expect(updateRouteSettings).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[5]).not.toBeChecked(),
    );
  });

  it('«Достижения»: старый API (404) — блока нет', async () => {
    getAchievementSettings.mockRejectedValueOnce(
      new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }),
    );
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Мероприятия' });
    await waitFor(() => expect(getAchievementSettings).toHaveBeenCalled());
    expect(screen.queryByRole('header', { name: 'Достижения' })).toBeNull();
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })).toHaveLength(6);
  });

  it('«Свои»: только push, последней из групп; тумблер сохраняет подресурс settings/social', async () => {
    await open('/settings/notifications');
    expect(await screen.findByRole('header', { name: 'Свои' })).toBeOnTheScreen();
    const headers = screen.getAllByRole('header').map((header) => header.props.children);
    expect(headers.indexOf('Свои')).toBe(headers.indexOf('Достижения') + 1);
    expect(headers.indexOf('Тихие часы')).toBe(headers.indexOf('Свои') + 1);
    const pushes = await screen.findAllByRole('switch', { name: 'Push-уведомления' });
    expect(pushes).toHaveLength(7);

    await fireEvent.press(pushes[6]!);

    await waitFor(() =>
      expect(updateSocialSettings).toHaveBeenCalledWith(liveSession.accessToken, { push: false }),
    );
    expect(updateSettings).not.toHaveBeenCalled();
    expect(updateAchievementSettings).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[6]).not.toBeChecked(),
    );
  });

  it('«Свои»: старый API (404) — блока нет', async () => {
    getSocialSettings.mockRejectedValueOnce(
      new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }),
    );
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Мероприятия' });
    await waitFor(() => expect(getSocialSettings).toHaveBeenCalled());
    expect(screen.queryByRole('header', { name: 'Свои' })).toBeNull();
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })).toHaveLength(6);
  });

  it('«Маршруты»: старый API (404) — блока нет', async () => {
    getRouteSettings.mockRejectedValueOnce(
      new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }),
    );
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Мероприятия' });
    await waitFor(() => expect(getRouteSettings).toHaveBeenCalled());
    expect(screen.queryByRole('header', { name: 'Маршруты' })).toBeNull();
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })).toHaveLength(6);
  });

  it('«Маршруты»: ошибка сохранения — баннер и прежнее значение', async () => {
    updateRouteSettings.mockRejectedValue(
      new ApiNetworkError(new TypeError('Network request failed')),
    );
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Маршруты' });
    await fireEvent.press((await screen.findAllByRole('switch', { name: 'Push-уведомления' }))[3]!);
    expect(await screen.findByText('Не удалось сохранить настройки. Повторите.')).toBeOnTheScreen();
    expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[3]).toBeChecked();
  });

  it('«Маршруты»: после сохранения основных настроек тумблер перечитан (значение «Райдов», RC-F2)', async () => {
    await open('/settings/notifications');
    await screen.findByRole('header', { name: 'Маршруты' });
    await waitFor(() => expect(getRouteSettings).toHaveBeenCalledTimes(1));
    getRouteSettings.mockResolvedValue({ push: false });
    const pushes = await screen.findAllByRole('switch', { name: 'Push-уведомления' });

    await fireEvent.press(pushes[2]!);

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getRouteSettings).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByRole('switch', { name: 'Push-уведомления' })[3]).not.toBeChecked(),
    );
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
