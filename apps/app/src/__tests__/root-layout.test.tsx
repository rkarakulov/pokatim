/// <reference types="jest" />
import { useFonts } from 'expo-font';
import { renderRouter, screen } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';

import { storeSession, storeSurveyCompleted } from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/lib/api');

const mockedUseFonts = jest.mocked(useFonts);
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
    mockedUseFonts.mockReturnValue([false, null]);
    await renderRouter(app);

    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  it('пока сессия не прочитана из SecureStore — splash не скрыт, контента нет (скелетон оболочки)', async () => {
    mockedUseFonts.mockReturnValue([true, null]);
    jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(new Promise(() => undefined));
    await renderRouter(app);

    expect(await screen.findByRole('progressbar', { name: 'Загрузка' })).toBeOnTheScreen();
    expect(screen.queryByRole('header')).toBeNull();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  });

  it('шрифты загружены — splash скрыт, открыта Главная', async () => {
    mockedUseFonts.mockReturnValue([true, null]);
    await renderRouter(app);

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it('ошибка шрифтов не блокирует запуск и пишется в лог', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockedUseFonts.mockReturnValue([false, new Error('font failed')]);
    await renderRouter(app);

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('font failed'));
    warn.mockRestore();
  });
});
