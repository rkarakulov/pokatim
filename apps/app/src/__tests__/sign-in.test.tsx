/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { SignInResponse } from '@pokatim/contracts';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useRegistrationStore } from '@/features/auth/registration-store';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import {
  EMAIL,
  NOW,
  REGISTRATION_TOKEN,
  session,
  storedValue,
  storeSession,
  storeSurveyCompleted,
} from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const signIn = jest.mocked(api.signIn);
const submitButton = () => screen.getByRole('button', { name: 'Войти' });
const apiError = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: code, details });

beforeEach(() => {
  // опрос онбординга уже пройден (кеш устройства): сценарии ведут на Главную; сам онбординг — onboarding-guard.test
  storeSurveyCompleted();
  jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' });
  jest.mocked(api.signOut).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

async function openSignIn() {
  const router = await renderRouter(appRoutes, { initialUrl: '/sign-in' });
  await screen.findByRole('header', { name: 'Вход' });
  return router;
}

async function fill(email = EMAIL, password = 'velo-secret') {
  await fireEvent.changeText(screen.getByLabelText('E-mail'), email);
  await fireEvent.changeText(screen.getByLabelText('Пароль'), password);
}

describe('«Вход»', () => {
  it('ошибки полей при уходе с поля — по кодам контракта', async () => {
    await openSignIn();

    const email = screen.getByLabelText('E-mail');
    await fireEvent.changeText(email, 'ivan@');
    await fireEvent(email, 'blur');
    expect(await screen.findByText('Проверьте e-mail: в адресе ошибка.')).toBeOnTheScreen();

    const password = screen.getByLabelText('Пароль');
    await fireEvent.changeText(password, 'x');
    await fireEvent.changeText(password, '');
    await fireEvent(password, 'blur');
    expect(await screen.findByText('Заполните поле.')).toBeOnTheScreen();
  });

  it('успех: кнопка busy на время запроса, затем Главная; сессия в SecureStore; пробелы e-mail срезаны', async () => {
    let resolve: (value: SignInResponse) => void = () => undefined;
    signIn.mockReturnValue(new Promise((done) => (resolve = done)));
    const router = await openSignIn();
    await fill(` ${EMAIL} `);

    await fireEvent.press(submitButton());
    expect(submitButton()).toBeBusy();
    expect(signIn).toHaveBeenCalledWith({ email: EMAIL, password: 'velo-secret' });

    await act(async () => resolve({ state: 'signedIn', session }));
    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(JSON.parse(storedValue('pokatim.session') ?? '{}')).toEqual(session);
  });

  it('401 — нейтральный баннер «Неверный e-mail или пароль.», без подсказки, что именно неверно', async () => {
    signIn.mockRejectedValue(apiError(401, 'INVALID_CREDENTIALS'));
    await openSignIn();
    await fill();

    await fireEvent.press(submitButton());

    expect(await screen.findByText('Неверный e-mail или пароль.')).toBeOnTheScreen();
    expect(submitButton()).toBeEnabled();
  });

  it('429 — баннер с отсчётом по retryAfterSec, кнопка выключена до конца паузы; без «осталось N попыток»', async () => {
    jest.useFakeTimers({ now: NOW });
    signIn.mockRejectedValue(apiError(429, 'RATE_LIMITED', { retryAfterSec: 125 }));
    await openSignIn();
    await fill();

    await fireEvent.press(submitButton());

    expect(
      await screen.findByText('Слишком много попыток входа. Попробуйте через 2:05.'),
    ).toBeOnTheScreen();
    expect(submitButton()).toBeDisabled();

    await act(() => jest.advanceTimersByTimeAsync(5000));
    expect(
      screen.getByText('Слишком много попыток входа. Попробуйте через 2:00.'),
    ).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTimeAsync(120_000));
    expect(screen.queryByText(/Слишком много попыток входа/)).toBeNull();
    expect(submitButton()).toBeEnabled();
  });

  it('нет сети — баннер «Нет соединения»', async () => {
    signIn.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openSignIn();
    await fill();

    await fireEvent.press(submitButton());

    expect(
      await screen.findByText('Нет соединения. Проверьте подключение к интернету и повторите.'),
    ).toBeOnTheScreen();
  });

  it('устройство офлайн (NetInfo) — запрос всё равно уходит, баннер «Нет соединения», кнопка снова доступна', async () => {
    signIn.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openSignIn();
    await fill();
    onlineManager.setOnline(false);

    await fireEvent.press(submitButton());

    expect(
      await screen.findByText('Нет соединения. Проверьте подключение к интернету и повторите.'),
    ).toBeOnTheScreen();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeEnabled();
  });

  it('e-mail не подтверждён — «Подтвердите e-mail» с новым токеном регистрации', async () => {
    signIn.mockResolvedValue({
      state: 'verificationRequired',
      registrationToken: REGISTRATION_TOKEN,
      email: EMAIL,
      resendAvailableInSec: 0,
    });
    const router = await openSignIn();
    await fill();

    await fireEvent.press(submitButton());

    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/check-email');
    expect(JSON.parse(storedValue('pokatim.registration') ?? '{}')).toMatchObject({
      registrationToken: REGISTRATION_TOKEN,
      email: EMAIL,
    });
    expect(useSessionStore.getState().status).not.toBe('signedIn');
  });

  it('e-mail из черновика регистрации подставлен; «Создать аккаунт» ведёт на регистрацию с введённым адресом', async () => {
    useRegistrationStore.getState().saveDraft({ email: EMAIL });
    const router = await openSignIn();

    expect(screen.getByDisplayValue(EMAIL)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'other@mail.by');
    await fireEvent.press(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(router.getPathname()).toBe('/register');
    expect(await screen.findByDisplayValue('other@mail.by')).toBeOnTheScreen();
  });

  it('«Войти» на регистрации переносит введённый e-mail в форму входа (через память, не URL)', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/register' });
    await screen.findByRole('header', { name: 'Создать аккаунт' });
    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);

    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expect(screen.getByDisplayValue(EMAIL)).toBeOnTheScreen();
  });
});

describe('регистрация ↔ вход: e-mail через черновик', () => {
  it('регистрация с адресом A → вход → адрес B → «Создать аккаунт» (назад к смонтированной форме) — в форме B', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/register' });
    await screen.findByRole('header', { name: 'Создать аккаунт' });
    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('header', { name: 'Вход' });

    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'other@mail.by');
    await fireEvent.press(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
    expect(screen.getByLabelText('E-mail')).toHaveDisplayValue('other@mail.by');
    expect(screen.queryByDisplayValue(EMAIL)).toBeNull();
  });
});

describe('«Создать аккаунт» со входа — всегда регистрация', () => {
  it('Регистрация → Вход → verificationRequired → «Подтвердите e-mail» → отказ poll → Войти → «Создать аккаунт» → регистрация', async () => {
    signIn.mockResolvedValue({
      state: 'verificationRequired',
      registrationToken: REGISTRATION_TOKEN,
      email: EMAIL,
      resendAvailableInSec: 0,
    });
    jest.mocked(api.pollRegistration).mockRejectedValue(apiError(401, 'UNAUTHORIZED'));
    const router = await renderRouter(appRoutes, { initialUrl: '/register' });
    await screen.findByRole('header', { name: 'Создать аккаунт' });
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('header', { name: 'Вход' });
    await fill();
    await fireEvent.press(submitButton());
    expect(await screen.findByRole('header', { name: 'Войдите в аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/check-email');

    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByRole('header', { name: 'Вход' });
    expect(router.getPathname()).toBe('/sign-in');
    await fireEvent.press(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
  });
});

describe('выход', () => {
  it('«Выйти» на Главной → сервер отзывает сессию, SecureStore и кеш запросов пусты, экран «Вход» (не регистрация)', async () => {
    const clear = jest.spyOn(QueryClient.prototype, 'clear');
    storeSession();
    const router = await renderRouter(appRoutes, { initialUrl: '/' });
    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));

    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expect(api.signOut).toHaveBeenCalledWith({ refreshToken: session.refreshToken });
    expect(storedValue('pokatim.session')).toBeUndefined();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('офлайн — выход всё равно локальный', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest
      .mocked(api.signOut)
      .mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    storeSession();
    await renderRouter(appRoutes, { initialUrl: '/' });
    await screen.findByRole('header', { name: 'Покатим' });

    await fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));

    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(storedValue('pokatim.session')).toBeUndefined();
    warn.mockRestore();
  });

  it('фоновая ротация при запуске получила 401 — экран «Вход»', async () => {
    jest.mocked(api.refreshSession).mockRejectedValue(apiError(401, 'UNAUTHORIZED'));
    storeSession();
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expect(storedValue('pokatim.session')).toBeUndefined();
  });

  it('офлайн-старт — в аккаунте (Главная), сессия не тронута', async () => {
    jest
      .mocked(api.refreshSession)
      .mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    storeSession();
    storeSurveyCompleted();
    await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(JSON.parse(storedValue('pokatim.session') ?? '{}')).toEqual(session);
    // опрос пройден — по кешу устройства, сервер не спрашивается (AC6)
    expect(api.getOnboardingStatus).not.toHaveBeenCalled();
  });
});
