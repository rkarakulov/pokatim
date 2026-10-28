/// <reference types="jest" />
import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import type { ReactNode } from 'react';

import { appThemeWrapper } from '@/__tests__/app-theme-wrapper';
import { createQueryWrapper } from '@/__tests__/query-wrapper';
import { api } from '@/lib/api';

import { DecorLayer } from './decor-layer';
import { HalloweenDecor } from './halloween-decor';

jest.mock('@/lib/api');

const getAppearance = jest.mocked(api.getAppearance);
const reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');

function wrapper() {
  const Query = createQueryWrapper();
  const Theme = appThemeWrapper('classic');
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Query>
        <Theme>{children}</Theme>
      </Query>
    );
  };
}

beforeEach(() => reduceMotion.mockResolvedValue(true));
afterEach(() => jest.clearAllMocks());

describe('DecorLayer (halloween-decor AC4)', () => {
  it('decor: halloween — слой декора', async () => {
    getAppearance.mockResolvedValue({ themeId: 'classic', decor: 'halloween' });
    await render(<DecorLayer />, { wrapper: wrapper() });
    expect(
      await screen.findByTestId('halloween-decor', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it.each([
    ['none', { themeId: 'classic', decor: 'none' }],
    ['незнакомый', { themeId: 'classic', decor: 'unknown' }],
    ['нет поля (старый API)', { themeId: 'classic' }],
  ] as const)('%s — без слоя', async (_, appearance) => {
    getAppearance.mockResolvedValue(appearance);
    await render(<DecorLayer />, { wrapper: wrapper() });
    await waitFor(() => expect(getAppearance).toHaveBeenCalled());
    expect(screen.queryByTestId('halloween-decor', { includeHiddenElements: true })).toBeNull();
  });

  it('ошибка запроса — без слоя', async () => {
    getAppearance.mockRejectedValue(new Error('network'));
    await render(<DecorLayer />, { wrapper: wrapper() });
    await waitFor(() => expect(getAppearance).toHaveBeenCalled());
    expect(screen.queryByTestId('halloween-decor', { includeHiddenElements: true })).toBeNull();
  });
});

describe('HalloweenDecor native (AC5)', () => {
  it('касания не перехватывает, скрыт от скринридеров; фигуры — react-native-svg', async () => {
    await render(<HalloweenDecor />, { wrapper: wrapper() });
    const layer = screen.getByTestId('halloween-decor', { includeHiddenElements: true });
    expect(layer.props.pointerEvents).toBe('none');
    expect(layer.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(layer.props.accessibilityElementsHidden).toBe(true);
    await waitFor(() =>
      expect(
        screen.getAllByTestId('svg-Path', { includeHiddenElements: true }).length,
      ).toBeGreaterThan(5),
    );
  });

  it('reduce motion — без анимаций; выключен — паук и ведьма анимируются', async () => {
    // циклы — без реальных таймеров (кадр анимации после теста бил бы в разобранное окружение)
    const start = jest.fn();
    const stop = jest.fn();
    const loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() });
    const view = await render(<HalloweenDecor />, { wrapper: wrapper() });
    await waitFor(() => expect(reduceMotion).toHaveBeenCalled());
    expect(loop).not.toHaveBeenCalled();
    await view.unmount();

    reduceMotion.mockResolvedValue(false);
    const animated = await render(<HalloweenDecor />, { wrapper: wrapper() });
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await animated.unmount();
    expect(stop).toHaveBeenCalledTimes(2);
    loop.mockRestore();
  });
});
