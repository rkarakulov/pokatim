/// <reference types="jest" />
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import NotFoundRoute from '../app/+not-found';
import UiKitScreen from '../app/ui-kit';
import { appRoutes, tabRoutes } from './app-routes';
import { signInForTest } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

beforeEach(() => {
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRides).mockResolvedValue({ items: [], nextCursor: null });
  jest
    .mocked(api.getProfile)
    .mockResolvedValue({ rideReasons: [], publicName: null, showNameInResults: false });
});
afterEach(() => jest.clearAllMocks());

// вошедший — без корневого layout (его гидрация сессии — auth-guard.test)
const signedInRoutes = { ...tabRoutes, '+not-found': NotFoundRoute, 'ui-kit': UiKitScreen };
const openSignedIn = (initialUrl: string) => {
  signInForTest();
  return renderRouter(signedInRoutes, { initialUrl, wrapper: createQueryWrapper() });
};

// __DEV__ в типах RN — константа; в тестах переключаем как глобальное значение
const setDev = (value: boolean) => Object.assign(globalThis, { __DEV__: value });

describe('неизвестный адрес (B1 смоука dev)', () => {
  it('гость: «Страница не найдена» по-русски и «На главную»', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    const router = await renderRouter(appRoutes, { initialUrl: '/profile' });

    expect(await screen.findByRole('header', { name: 'Страница не найдена' })).toBeOnTheScreen();
    expect(screen.queryByText(/Unmatched Route/)).toBeNull();
    expect(screen.queryByText('Sitemap')).toBeNull();
    expect(router.getPathname()).toBe('/profile');
  });

  it('вошедший: «На главную» ведёт на Главную', async () => {
    const router = await openSignedIn('/no/such/page');

    await fireEvent.press(await screen.findByRole('button', { name: 'На главную' }));
    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  it('витрина /ui-kit в production — тот же экран «не найдено»', async () => {
    const devFlag = __DEV__;
    setDev(false);
    try {
      await openSignedIn('/ui-kit');
      expect(await screen.findByRole('header', { name: 'Страница не найдена' })).toBeOnTheScreen();
      expect(screen.queryByText('Кнопки')).toBeNull();
    } finally {
      setDev(devFlag);
    }
  });
});
