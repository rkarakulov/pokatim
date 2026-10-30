/// <reference types="jest" />
import { DEFAULT_NOTIFICATION_SETTINGS } from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderRouter, screen } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import NotificationSettingsScreen from '../app/settings/notifications';
import { liveSession, signInForTest } from './auth-fixtures';

jest.mock('@/lib/api');
// платформа без push (web без Web Push: `push.web.ts`) — та же развилка, что даёт файл платформы
jest.mock('@/features/notifications/push', () => ({
  ...jest.requireActual('@/features/notifications/push'),
  usePushSupported: () => false,
}));

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  jest.mocked(api.getNotificationSettings).mockResolvedValue(DEFAULT_NOTIFICATION_SETTINGS);
  jest.mocked(api.getEventNotificationSettings).mockResolvedValue({ push: true, email: true });
});
afterEach(() => jest.clearAllMocks());

async function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderRouter(
    { 'settings/notifications': NotificationSettingsScreen },
    { initialUrl: '/settings/notifications', wrapper },
  );
}

describe('«Настройки уведомлений» без push (web)', () => {
  it('только письма: без push-тумблеров, тихих часов и группы без e-mail', async () => {
    await open();
    expect(await screen.findByRole('header', { name: 'Споры' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Райды' })).toBeOnTheScreen();
    expect(await screen.findByRole('header', { name: 'Мероприятия' })).toBeOnTheScreen();
    expect(screen.getAllByRole('switch', { name: 'Письма на e-mail' })).toHaveLength(3);
    expect(screen.queryByRole('switch', { name: 'Push-уведомления' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Гонки и результаты' })).toBeNull();
    expect(screen.queryByRole('header', { name: 'Тихие часы' })).toBeNull();
    // «Маршруты» — только push: без push блока нет и запроса нет
    expect(screen.queryByRole('header', { name: 'Маршруты' })).toBeNull();
    expect(api.getRouteNotificationSettings).not.toHaveBeenCalled();
    expect(screen.queryByText(/push/i)).toBeNull();
    expect(
      screen.getByText('В центре уведомлений видно всё. Здесь — письма на e-mail.'),
    ).toBeOnTheScreen();
  });
});
