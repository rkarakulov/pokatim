/// <reference types="jest" />
import { appThemes, themes } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { TabBar } from './tab-bar';

const routes = [
  { key: 'index-1', name: 'index' },
  { key: 'routes-1', name: 'routes' },
];

function props(index: number): BottomTabBarProps {
  return {
    state: { index, routes },
    descriptors: {
      'index-1': { options: { title: 'Главная' } },
      'routes-1': { options: { title: 'Маршруты' } },
    },
    emitter: { emit: () => ({ defaultPrevented: false }) },
    navigateToTab: jest.fn(),
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as BottomTabBarProps;
}

describe('TabBar: роли tabBar (app-themes C1)', () => {
  it('«Классика» — прежние цвета: фон surface.default, полоса и подпись активной — text.primary', async () => {
    await render(<TabBar {...props(0)} />);
    const { light } = themes;
    expect(screen.getByTestId('tab-bar')).toHaveStyle({ backgroundColor: light.surface.default });
    expect(screen.getByTestId('tab-indicator-index')).toHaveStyle({
      backgroundColor: light.text.primary,
    });
    expect(screen.getByText('Главная')).toHaveStyle({ color: light.text.primary });
    expect(screen.getByText('Маршруты')).toHaveStyle({ color: light.text.secondary });
  });

  it('Хронометр — фон, активная и неактивная из tabBar темы', async () => {
    await render(<TabBar {...props(1)} />, { wrapper: appThemeWrapper('chrono') });
    const { tabBar } = appThemes.chrono.schemes.dark;
    expect(screen.getByTestId('tab-bar')).toHaveStyle({ backgroundColor: tabBar.background });
    expect(screen.getByText('Маршруты')).toHaveStyle({ color: tabBar.active });
    expect(screen.getByText('Главная')).toHaveStyle({ color: tabBar.inactive });
  });
});
