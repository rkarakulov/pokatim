/// <reference types="jest" />
import { layout } from '@pokatim/design-tokens';
import * as Font from 'expo-font';
import { renderRouter, screen } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';

import { storeSession, storeSurveyCompleted } from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('expo-font', () => ({ isLoaded: jest.fn(), loadAsync: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/lib/api');

// шрифты темы (`useThemeFonts`): загружены, грузятся (не завершится) или загрузка упала
function mockFonts(state: 'loaded' | 'loading' | Error) {
  jest.mocked(Font.isLoaded).mockReturnValue(state === 'loaded');
  jest
    .mocked(Font.loadAsync)
    .mockReturnValue(
      state === 'loaded'
        ? Promise.resolve()
        : state === 'loading'
          ? new Promise(() => undefined)
          : Promise.reject(state),
    );
}
const app = appRoutes;

// вошедший пользователь с пройденным опросом: проверяем splash и шрифты на Главной (гард — в auth-guard.test)
beforeEach(() => {
  storeSession();
  storeSurveyCompleted();
});
afterEach(() => jest.clearAllMocks());

describe('корневой layout: splash и шрифты', () => {
  it('splash удерживается при старте модуля, до первого рендера', () => {
    // вызов на уровне модуля — проверяем до первого clearAllMocks
    expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalled();
  });

  it('пока шрифты грузятся — splash не скрыт и экран не рендерится', async () => {
    mockFonts('loading');
    await renderRouter(app);

    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  it('пока сессия не прочитана из SecureStore — splash не скрыт, контента нет (скелетон оболочки)', async () => {
    mockFonts('loaded');
    jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(new Promise(() => undefined));
    await renderRouter(app);

    expect(await screen.findByRole('progressbar', { name: 'Загрузка' })).toBeOnTheScreen();
    expect(screen.queryByRole('header')).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  it('кэш темы не прочитан — splash не скрыт и экран не рендерится', async () => {
    mockFonts('loaded');
    const read = jest.mocked(SecureStore.getItemAsync).getMockImplementation();
    jest
      .mocked(SecureStore.getItemAsync)
      .mockImplementation((key, options) =>
        key === 'pokatim.appTheme' ? new Promise(() => undefined) : read!(key, options),
      );
    await renderRouter(app);

    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Загрузка' })).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    if (read) jest.mocked(SecureStore.getItemAsync).mockImplementation(read);
  });

  it('шрифты загружены — splash скрыт, открыта Главная', async () => {
    mockFonts('loaded');
    await renderRouter(app);

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it('ошибка шрифтов не блокирует запуск и пишется в лог', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFonts(new Error('font failed'));
    await renderRouter(app);

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('font failed'));
    warn.mockRestore();
  });

  it('колонка экранов не шире layout.contentMaxWidth, по центру (B20 смоука dev)', async () => {
    mockFonts('loaded');
    await renderRouter(app);
    await screen.findByRole('header', { name: 'Покатим' });

    expect(screen.getByTestId('app-column')).toHaveStyle({
      width: '100%',
      maxWidth: layout.contentMaxWidth,
      alignSelf: 'center',
    });
  });
});
