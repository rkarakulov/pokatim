/// <reference types="jest" />
import { DEFAULT_NOTIFICATION_SETTINGS } from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import NotificationSettingsScreen from '../app/settings/notifications';
import { liveSession, signInForTest } from './auth-fixtures';

jest.mock('@/lib/api');

const getPermissions = jest.mocked(Notifications.getPermissionsAsync);
const requestPermissions = jest.mocked(Notifications.requestPermissionsAsync);
const updateSettings = jest.mocked(api.updateNotificationSettings);

const BLOCKED = 'Не придут на это устройство, пока push не включены в строке выше.';
const ENABLE_HINT = 'Нажмите, чтобы разрешить push-уведомления на этом устройстве.';
const permission = (status: string, canAskAgain: boolean) => ({ status, canAskAgain }) as never;

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  // «Гонки» выключены — включение тумблера проверяет запрос разрешения
  jest.mocked(api.getNotificationSettings).mockResolvedValue({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    push: { ...DEFAULT_NOTIFICATION_SETTINGS.push, races: false },
  });
  // сервер возвращает сохранённое и при перечитывании
  updateSettings.mockImplementation(async (_token, body) => {
    jest.mocked(api.getNotificationSettings).mockResolvedValue(body);
    return body;
  });
  jest.mocked(api.registerPushToken).mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  await renderRouter(
    { 'settings/notifications': NotificationSettingsScreen },
    { initialUrl: '/settings/notifications', wrapper },
  );
  return screen.findAllByRole('switch', { name: 'Push-уведомления' });
}

describe('«Настройки уведомлений»: push-тумблеры и разрешение устройства (N5)', () => {
  it('разрешение не спрашивали: включённые тумблеры подписаны «не придут»', async () => {
    getPermissions.mockResolvedValue(permission('undetermined', true));
    await open();
    expect(await screen.findByText(ENABLE_HINT)).toBeOnTheScreen();
    // «Споры» и «Райды» включены, «Гонки» — нет
    expect(screen.getAllByText(BLOCKED)).toHaveLength(2);
  });

  it('включение тумблера сначала показывает системный запрос, затем сохраняет; разрешили — подписей нет', async () => {
    getPermissions.mockResolvedValue(permission('undetermined', true));
    requestPermissions.mockResolvedValue(permission('granted', true));
    const [racesPush] = await open();
    await screen.findByText(ENABLE_HINT);

    getPermissions.mockResolvedValue(permission('granted', true));
    await fireEvent.press(racesPush!);

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(liveSession.accessToken, {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        push: DEFAULT_NOTIFICATION_SETTINGS.push,
      }),
    );
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    // запрос — в том же нажатии, до сохранения (Safari показывает его только из жеста)
    expect(requestPermissions.mock.invocationCallOrder[0]).toBeLessThan(
      updateSettings.mock.invocationCallOrder[0]!,
    );
    await waitFor(() => expect(screen.queryByText(BLOCKED)).toBeNull());
    expect(screen.queryByText(ENABLE_HINT)).toBeNull();
  });

  it('отказали в системном запросе — настройка сохранена, подписи «не придут» остаются', async () => {
    getPermissions.mockResolvedValue(permission('undetermined', true));
    requestPermissions.mockResolvedValue(permission('denied', false));
    const [racesPush] = await open();
    await screen.findByText(ENABLE_HINT);

    await fireEvent.press(racesPush!);

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        'Push-уведомления запрещены. Нажмите, чтобы открыть настройки устройства.',
      ),
    ).toBeOnTheScreen();
    await waitFor(() => expect(screen.getAllByText(BLOCKED)).toHaveLength(3));
  });

  it('выключение тумблера разрешение не запрашивает', async () => {
    getPermissions.mockResolvedValue(permission('undetermined', true));
    const [, disputesPush] = await open();
    await screen.findByText(ENABLE_HINT);

    await fireEvent.press(disputesPush!);

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('отказ навсегда: включение тумблера запрос не показывает и настройки ОС не открывает', async () => {
    getPermissions.mockResolvedValue(permission('denied', false));
    const [racesPush] = await open();
    await screen.findByText(
      'Push-уведомления запрещены. Нажмите, чтобы открыть настройки устройства.',
    );

    await fireEvent.press(racesPush!);

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(requestPermissions).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByText(BLOCKED)).toHaveLength(3));
  });

  it('разрешение выдано — ни строки, ни подписей', async () => {
    getPermissions.mockResolvedValue(permission('granted', true));
    await open();
    await waitFor(() => expect(getPermissions).toHaveBeenCalled());
    expect(screen.queryByText(BLOCKED)).toBeNull();
    expect(screen.queryByText(ENABLE_HINT)).toBeNull();
  });
});
