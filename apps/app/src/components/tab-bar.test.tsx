/// <reference types="jest" />
import { appThemes, themes } from '@pokatim/design-tokens';
import { render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { SymbolView } from 'expo-symbols';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { TabBar } from './tab-bar';

jest.mock('expo-symbols', () => ({ SymbolView: jest.fn(() => null) }));
const symbol = jest.mocked(SymbolView);

afterEach(() => jest.clearAllMocks());

const routes = [
  { key: 'index-1', name: 'index' },
  { key: 'races-1', name: 'races' },
  { key: 'rides-1', name: 'rides' },
  { key: 'routes-1', name: 'routes' },
  { key: 'calendar-1', name: 'calendar' },
];

function props(index: number): BottomTabBarProps {
  return {
    state: { index, routes },
    descriptors: {
      'index-1': { options: { title: 'Главная' } },
      'races-1': { options: { title: 'Гонки' } },
      'rides-1': { options: { title: 'Райды' } },
      'routes-1': { options: { title: 'Маршруты' } },
      'calendar-1': { options: { title: 'Календарь' } },
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
    await render(<TabBar {...props(3)} />, { wrapper: appThemeWrapper('chrono') });
    const { tabBar } = appThemes.chrono.schemes.dark;
    expect(screen.getByTestId('tab-bar')).toHaveStyle({ backgroundColor: tabBar.background });
    expect(screen.getByText('Маршруты')).toHaveStyle({ color: tabBar.active });
    expect(screen.getByText('Главная')).toHaveStyle({ color: tabBar.inactive });
  });
});

describe('TabBar: варианты (app-themes C2)', () => {
  it('classic — полоса сверху у активной, иконка над подписью у 5 вкладок; цвета — роли tabBar', async () => {
    await render(<TabBar {...props(0)} />);
    const { tabBar } = themes.light;
    expect(screen.getByTestId('tab-indicator-index')).toHaveStyle({
      backgroundColor: tabBar.active,
    });
    expect(screen.getByTestId('tab-indicator-routes')).toHaveStyle({
      backgroundColor: 'transparent',
    });
    const calls = symbol.mock.calls.map(([p]) => p);
    expect(calls.map((p) => p.name)).toEqual([
      { ios: 'house.fill', android: 'home', web: 'home' },
      { ios: 'flag.checkered', android: 'sports_score', web: 'sports_score' },
      { ios: 'cup.and.saucer', android: 'local_cafe', web: 'local_cafe' },
      { ios: 'map', android: 'map', web: 'map' },
      { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
    ]);
    expect(calls.map((p) => p.tintColor)).toEqual([
      tabBar.active,
      tabBar.inactive,
      tabBar.inactive,
      tabBar.inactive,
      tabBar.inactive,
    ]);
    // имя вкладки — подпись, иконка его не меняет
    expect(screen.getByRole('tab', { name: 'Главная', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Маршруты', selected: false })).toBeOnTheScreen();
  });

  it('icons — иконка над подписью у 5 вкладок, полосы нет; активная — tabBar.active и заливка', async () => {
    await render(<TabBar {...props(3)} />, { wrapper: appThemeWrapper('atlas') });
    const { tabBar } = appThemes.atlas.schemes.light;
    expect(screen.queryByTestId('tab-indicator-routes')).toBeNull();
    const calls = symbol.mock.calls.map(([p]) => p);
    expect(calls.map((p) => p.name)).toEqual([
      { ios: 'house', android: 'home', web: 'home' },
      { ios: 'flag.checkered', android: 'sports_score', web: 'sports_score' },
      { ios: 'cup.and.saucer', android: 'local_cafe', web: 'local_cafe' },
      { ios: 'map.fill', android: 'map', web: 'map' },
      { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
    ]);
    expect(calls.map((p) => p.tintColor)).toEqual([
      tabBar.inactive,
      tabBar.inactive,
      tabBar.inactive,
      tabBar.active,
      tabBar.inactive,
    ]);
    expect(screen.getByRole('tab', { name: 'Маршруты', selected: true })).toBeOnTheScreen();
    expect(screen.getByText('Маршруты')).toHaveStyle({ color: tabBar.active });
  });
});
