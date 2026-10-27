/// <reference types="jest" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import * as Notifications from 'expo-notifications';
import { useState } from 'react';
import { Text } from 'react-native';
import { create } from 'zustand';

import { PushNotifications } from './push-registration';

const RIDE = '0190a6f4-0000-7000-8000-000000000002';
const lastResponse = jest.mocked(Notifications.getLastNotificationResponse);

/** Шрифты темы ещё грузятся: корень, как `RootShell`/`AppThemeProvider`, ничего не рендерит до их готовности. */
const useFonts = create<{ ready: boolean }>(() => ({ ready: false }));

function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const fontsReady = useFonts((state) => state.ready);
  return (
    <QueryClientProvider client={queryClient}>
      {fontsReady ? (
        <>
          <Stack />
          <PushNotifications ready />
        </>
      ) : null}
    </QueryClientProvider>
  );
}

const routes = {
  _layout: RootLayout,
  index: () => <Text>Главная</Text>,
  'rides/[id]': () => <Text>Карточка райда</Text>,
};

afterEach(() => {
  jest.clearAllMocks();
  useFonts.setState({ ready: false });
});

describe('нажатие на push при холодном старте (N10)', () => {
  it('сессия восстановлена раньше шрифтов — переход к цели после монтирования навигатора, ответ гасится', async () => {
    lastResponse.mockReturnValue({
      notification: { request: { content: { data: { target: { type: 'ride', rideId: RIDE } } } } },
      actionIdentifier: 'default',
    } as never);
    const router = await renderRouter(routes, { initialUrl: '/' });

    // навигатора ещё нет — ответ не тронут, перехода нет
    expect(Notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponse).not.toHaveBeenCalled();

    await act(async () => useFonts.setState({ ready: true }));

    expect(router.getPathname()).toBe(`/rides/${RIDE}`);
    expect(screen.getByText('Карточка райда')).toBeOnTheScreen();
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
    expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
  });
});
