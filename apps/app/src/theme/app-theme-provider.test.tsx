/// <reference types="jest" />
import { appThemes, themes, type AppTheme, type AppThemeId } from '@pokatim/design-tokens';
import { useTheme } from '@rkarakulov/ui';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { AppThemeProvider } from './app-theme-provider';
import { themeFonts } from './fonts';
import { useAppTheme } from './use-app-theme';
import { useThemeFonts } from './use-theme-fonts';

// фикстуры реестра: «atlas» — своя светлая поверхность, «chrono» — всегда тёмная (в B реальных отличий нет)
jest.mock('@pokatim/design-tokens', () => {
  const actual = jest.requireActual<{ appThemes: typeof appThemes }>('@pokatim/design-tokens');
  const { classic } = actual.appThemes;
  const atlasLight = {
    ...classic.schemes.light,
    surface: { ...classic.schemes.light.surface, default: '#ABCDEF' },
  };
  return {
    ...actual,
    appThemes: {
      ...actual.appThemes,
      atlas: { ...classic, id: 'atlas', schemes: { light: atlasLight, dark: atlasLight } },
      chrono: {
        ...classic,
        id: 'chrono',
        colorScheme: 'dark',
        schemes: { light: classic.schemes.dark, dark: classic.schemes.dark },
      },
    },
  };
});
jest.mock('./use-theme-fonts', () => ({ useThemeFonts: jest.fn() }));

const fonts = jest.mocked(useThemeFonts);
let atlasFontsReady = true;

beforeEach(() => {
  atlasFontsReady = true;
  fonts.mockImplementation((set) =>
    set === themeFonts(appThemes.atlas) && !atlasFontsReady
      ? { ready: false, error: null }
      : { ready: true, error: null },
  );
});

function Screen() {
  const [count, setCount] = useState(0);
  const colors = useTheme<AppTheme>();
  const { id, scheme } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => setCount((n) => n + 1)}>
      <Text testID="probe">{`${id} ${scheme} ${colors.surface.default} ${count}`}</Text>
    </Pressable>
  );
}

const tree = (themeId: AppThemeId) => (
  <AppThemeProvider themeId={themeId}>
    <Screen />
  </AppThemeProvider>
);

describe('AppThemeProvider', () => {
  it('смена темы перерисовывает экран в новой теме без перемонтирования (состояние сохранено)', async () => {
    const view = await render(tree('classic'));
    await fireEvent.press(screen.getByRole('button'));
    expect(screen.getByTestId('probe')).toHaveTextContent(
      `classic light ${themes.light.surface.default} 1`,
    );

    await view.rerender(tree('atlas'));
    expect(screen.getByTestId('probe')).toHaveTextContent('atlas light #ABCDEF 1');
  });

  it('пока шрифты новой темы грузятся — остаётся прежняя тема, затем — новая', async () => {
    atlasFontsReady = false;
    const view = await render(tree('classic'));
    await view.rerender(tree('atlas'));
    expect(screen.getByTestId('probe')).toHaveTextContent(
      `classic light ${themes.light.surface.default} 0`,
    );

    atlasFontsReady = true;
    await act(async () => view.rerender(tree('atlas')));
    expect(screen.getByTestId('probe')).toHaveTextContent('atlas light #ABCDEF 0');
  });

  it('первый запуск: шрифты не готовы — ничего не рисует (корень держит сплэш)', async () => {
    atlasFontsReady = false;
    await render(tree('atlas'));
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('ошибка шрифтов — тема применяется, ошибка уходит в onFontError', async () => {
    const failure = new Error('font failed');
    fonts.mockReturnValue({ ready: true, error: failure });
    const onFontError = jest.fn();
    await render(
      <AppThemeProvider themeId="classic" onFontError={onFontError}>
        <Screen />
      </AppThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(/^classic /);
    expect(onFontError).toHaveBeenCalledWith(failure);
  });

  it('тема «всегда тёмная» при светлой системе — тёмная схема', async () => {
    await render(tree('chrono'));
    expect(screen.getByTestId('probe')).toHaveTextContent(
      `chrono dark ${themes.dark.surface.default} 0`,
    );
  });

  it('useAppTheme без провайдера — «Классика» по схеме темы базы', async () => {
    await render(<Screen />);
    expect(screen.getByTestId('probe')).toHaveTextContent(
      `classic light ${themes.light.surface.default} 0`,
    );
  });
});
