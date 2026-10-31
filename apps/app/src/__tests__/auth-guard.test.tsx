/// <reference types="jest" />
// разбор входящего URL тем же кодом, что у Router на устройстве (публичный путь пакета `./build/*`)
import { extractExpoPathFromURL } from 'expo-router/build/fork/extractPathFromURL';
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import * as persistence from '@/features/auth/session-persistence';
import { api } from '@/lib/api';

import {
  LINK_TOKEN,
  session,
  storePendingRegistration,
  storeSession,
  storeSurveyCompleted,
} from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');

describe('гард сессии (Stack.Protected)', () => {
  it('без сессии новый гость видит лендинг, вкладок нет (guest-landing)', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
  });

  it('свой профиль /profile без сессии — лендинг (rider-profile: экран под гардом)', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/profile' });

    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
    expect(api.getProfileStats).not.toHaveBeenCalled();
  });

  it('«Свои» /social без сессии — лендинг (P3: экран под гардом), список не запрашивается', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/social' });

    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
    expect(api.listSocialConnections).not.toHaveBeenCalled();
  });

  it('пока сессия не прочитана — на месте вкладок скелетон оболочки, без редиректа (SSR, R2)', async () => {
    // и сессия, и регистрация ещё читаются из хранилища
    const never = new Promise<string | null>(() => undefined);
    jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(never).mockReturnValueOnce(never);
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByRole('progressbar', { name: 'Загрузка' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(
      screen.queryByRole('header', { name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах' }),
    ).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
  });

  it.each([
    ['429', new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x' }), 'Не удалось загрузить'],
    ['нет сети', new ApiNetworkError(new TypeError('Failed to fetch')), 'Нет соединения'],
  ])(
    'сессию проверить не удалось (web: %s после повторов) — не выход: на месте вкладок ошибка с повтором',
    async (_case, error, title) => {
      const restore = jest.spyOn(persistence, 'restoreSession').mockRejectedValueOnce(error);
      const router = await renderRouter(appRoutes, { initialUrl: '/' });

      expect(await screen.findByText(title)).toBeOnTheScreen();
      expect(router.getPathname()).toBe('/');
      expect(
        screen.queryByRole('header', {
          name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
        }),
      ).toBeNull();

      // повтор — снова восстановление (здесь сессии нет → лендинг)
      await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
      expect(
        await screen.findByRole('header', {
          name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
        }),
      ).toBeOnTheScreen();
      expect(restore).toHaveBeenCalledTimes(2);
      restore.mockRestore();
    },
  );

  it('пока сессия не прочитана — регистрация открывается сразу (публичный экран, SSR)', async () => {
    jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(new Promise(() => undefined));
    const router = await renderRouter(appRoutes, { initialUrl: '/register' });

    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
  });

  it('сессия из SecureStore с живым refresh — сразу Главная, регистрация недоступна', async () => {
    storeSession();
    storeSurveyCompleted();
    const router = await renderRouter(appRoutes, { initialUrl: '/register' });

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  it('просроченный refresh — как без сессии', async () => {
    storeSession({ ...session, refreshTokenExpiresAt: '2020-01-01T00:00:00.000Z' });
    await renderRouter(appRoutes, { initialUrl: '/' });

    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
  });

  it('живая регистрация после перезапуска — сразу «Подтвердите e-mail»', async () => {
    storePendingRegistration();
    jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' });
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/check-email');
  });

  it('живая регистрация, гость уже на лендинге (стор регистрации догидрировался позже) — «Подтвердите e-mail»', async () => {
    storePendingRegistration();
    jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' });
    const router = await renderRouter(appRoutes, { initialUrl: '/welcome' });

    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/check-email');
  });

  it('ссылка из письма открывается и без сессии, и с сессией', async () => {
    jest.mocked(api.getVerificationLink).mockResolvedValue({ state: 'valid', email: 'a@b.by' });
    const router = await renderRouter(appRoutes, { initialUrl: `/auth/verify/${LINK_TOKEN}` });
    expect(await screen.findByRole('button', { name: 'Подтвердить e-mail' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/auth/verify/${LINK_TOKEN}`);
    expect(api.getVerificationLink).toHaveBeenCalledWith(LINK_TOKEN);
  });

  it.each([
    ['Expo Go', `exp://127.0.0.1:8081/--/auth/verify/${LINK_TOKEN}`, true],
    ['сборка', `pokatim://auth/verify/${LINK_TOKEN}`, false],
  ])('deep link из письма (%s) открывает экран ссылки с токеном', async (_name, url, expoGo) => {
    jest.mocked(api.getVerificationLink).mockResolvedValue({ state: 'valid', email: 'a@b.by' });
    // Router узнаёт Expo Go по нативному модулю ExpoGo и срезает `<host>/--/`
    const runtime = globalThis as { expo?: { modules?: Record<string, unknown> } };
    const modules = runtime.expo?.modules ?? {};
    runtime.expo = { ...runtime.expo, modules: { ...modules, ...(expoGo ? { ExpoGo: {} } : {}) } };
    const path = extractExpoPathFromURL([], url);
    runtime.expo.modules = modules;

    expect(path.replace(/^\//, '')).toBe(`auth/verify/${LINK_TOKEN}`);
    const router = await renderRouter(appRoutes, { initialUrl: `/${path.replace(/^\//, '')}` });

    expect(await screen.findByRole('button', { name: 'Подтвердить e-mail' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/auth/verify/${LINK_TOKEN}`);
    expect(api.getVerificationLink).toHaveBeenCalledWith(LINK_TOKEN);
  });

  it('с сессией ссылка тоже открывается (экран вне гарда)', async () => {
    storeSession();
    jest.mocked(api.getVerificationLink).mockResolvedValue({ state: 'verified', email: 'a@b.by' });
    await renderRouter(appRoutes, { initialUrl: `/auth/verify/${LINK_TOKEN}` });
    expect(await screen.findByRole('header', { name: 'E-mail подтверждён' })).toBeOnTheScreen();
  });
});
