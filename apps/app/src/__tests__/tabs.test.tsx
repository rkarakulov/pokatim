/// <reference types="jest" />
import { stroke, themes } from '@pokatim/design-tokens';
import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { useColorScheme } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession, signInForTest } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

// jest-пресет React Native подменяет useColorScheme на jest.fn(() => 'light')
const colorScheme = jest.mocked(useColorScheme);

afterEach(() => colorScheme.mockReturnValue('light'));

// вкладки — только после входа (гард и скелетон оболочки — auth-guard.test); Главная спрашивает профиль
beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  jest.mocked(api.getProfile).mockResolvedValue({ rideReasons: [] });
});

describe('нижние вкладки', () => {
  it('пять вкладок в порядке прототипа, Главная выбрана', async () => {
    await renderRouter(tabRoutes, { wrapper: createQueryWrapper() });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Главная',
      'Гонки',
      'Райды',
      'Маршруты',
      'Календарь',
    ]);
    expect(screen.getByRole('tab', { name: 'Главная' })).toBeSelected();
  });

  it('нажатие на вкладку открывает раздел и делает её выбранной', async () => {
    await renderRouter(tabRoutes, { wrapper: createQueryWrapper() });

    await fireEvent.press(screen.getByRole('tab', { name: 'Райды' }));

    expect(await screen.findByRole('header', { name: 'Кофе-райды' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Райды' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Главная' })).not.toBeSelected();
  });

  it('заголовок раздела — Playfair Display, активная вкладка — 600 с полосой, неактивная — 500', async () => {
    await renderRouter(tabRoutes, { wrapper: createQueryWrapper() });

    expect(screen.getByRole('header', { name: 'Ближайшие гонки' })).toHaveStyle({
      fontFamily: 'PlayfairDisplay_500Medium',
    });
    const light = themes.light;
    expect(screen.getByTestId('tab-indicator-index')).toHaveStyle({
      backgroundColor: light.text.primary,
      height: stroke.indicator,
    });
    expect(screen.getByTestId('tab-indicator-races')).toHaveStyle({
      backgroundColor: 'transparent',
    });
    const activeLabel = within(screen.getByRole('tab', { name: 'Главная' })).getByText('Главная');
    expect(activeLabel).toHaveStyle({ fontFamily: 'Inter_600SemiBold', color: light.text.primary });
    const inactiveLabel = within(screen.getByRole('tab', { name: 'Гонки' })).getByText('Гонки');
    expect(inactiveLabel).toHaveStyle({
      fontFamily: 'Inter_500Medium',
      color: light.text.secondary,
    });
  });

  it('тёмная системная тема → Night Ride на экране и панели вкладок', async () => {
    colorScheme.mockReturnValue('dark');
    await renderRouter(tabRoutes, { wrapper: createQueryWrapper() });

    const dark = themes.dark;
    expect(screen.getByTestId('tab-bar')).toHaveStyle({ backgroundColor: dark.surface.default });
    expect(screen.getByTestId('tab-indicator-index')).toHaveStyle({
      backgroundColor: dark.text.primary,
    });
    expect(screen.getByRole('header', { name: 'Ближайшие гонки' })).toHaveStyle({
      color: dark.text.primary,
    });
  });
});
