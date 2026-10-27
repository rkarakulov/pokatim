/// <reference types="jest" />
import { render, screen } from '@testing-library/react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';

import { TabBar } from './tab-bar';

const routes = [
  { key: 'index-1', name: 'index' },
  { key: 'section-1', name: 'section' },
];

// минимум навигатора вкладок: состояние, подписи, события
function props(index: number): BottomTabBarProps {
  return {
    state: { index, routes },
    descriptors: {
      'index-1': { options: { title: 'Главная' } },
      'section-1': { options: { title: 'Раздел' } },
    },
    emitter: { emit: () => ({ defaultPrevented: false }) },
    navigateToTab: jest.fn(),
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as BottomTabBarProps;
}

describe('панель вкладок в браузере (react-native-web)', () => {
  it('роли tablist/tab и выбранная вкладка — для скринридера', () => {
    render(<TabBar {...props(1)} />);

    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Раздел', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Главная', selected: false })).toBeTruthy();
  });

  it('клик по вкладке — переход', () => {
    const tabs = props(0);
    render(<TabBar {...tabs} />);

    screen.getByRole('tab', { name: 'Раздел' }).click();
    expect(tabs.navigateToTab).toHaveBeenCalledWith('section-1');
  });
});

describe('панель вкладок в браузере: вариант icons (app-themes C2)', () => {
  it('роли и выбранная вкладка сохраняются; полосы нет', () => {
    render(<TabBar {...props(0)} />, { wrapper: appThemeWrapper('atlas') });
    expect(screen.getByRole('tab', { name: 'Главная', selected: true })).toBeTruthy();
    expect(screen.queryByTestId('tab-indicator-index')).toBeNull();
  });
});
