/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { keepTogether } from '@rkarakulov/ui';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { api } from '@/lib/api';

import {
  EMAIL,
  NOW,
  REGISTRATION_TOKEN,
  session,
  storedValue,
  storePendingRegistration,
  storeSurveyCompleted,
} from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const poll = jest.mocked(api.pollRegistration);
const resend = jest.mocked(api.resendVerification);
const resendButton = (name = 'Отправить письмо ещё раз') => screen.getByRole('button', { name });

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  // опрос онбординга уже пройден (кеш устройства): сценарии ведут на Главную; сам онбординг — onboarding-guard.test
  storeSurveyCompleted();
  jest.useFakeTimers({ now: NOW });
  poll.mockResolvedValue({ state: 'pending' });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

/** Приложение перезапущено с живой регистрацией — экран восстанавливается из SecureStore. */
async function openCheckEmail(resendInSec = 60) {
  storePendingRegistration(NOW.getTime(), resendInSec);
  const router = await renderRouter(appRoutes, { initialUrl: '/' });
  await screen.findByRole('header', { name: 'Подтвердите e-mail' });
  return router;
}

describe('«Подтвердите e-mail»', () => {
  it('пока регистрация не прочитана из хранилища — скелетон, без редиректа и отсчёта (SSR, R2)', async () => {
    storePendingRegistration(NOW.getTime());
    const getItem = jest.mocked(SecureStore.getItemAsync);
    const original = getItem.getMockImplementation();
    getItem.mockImplementation((key) =>
      key === 'pokatim.registration' ? new Promise(() => undefined) : Promise.resolve(null),
    );
    try {
      const router = await renderRouter(appRoutes, { initialUrl: '/check-email' });

      expect(await screen.findByRole('progressbar', { name: 'Загрузка' })).toBeOnTheScreen();
      expect(router.getPathname()).toBe('/check-email');
      expect(screen.queryByText(/Повторно — через/)).toBeNull();
      expect(screen.queryByRole('header', { name: 'Создать аккаунт' })).toBeNull();
    } finally {
      if (original) getItem.mockImplementation(original);
    }
  });

  it('прочитана, регистрации нет — к «Создать аккаунт»', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/check-email' });

    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
  });

  it('опрос без сети — «Нет соединения» с повтором, экран и действия остаются', async () => {
    poll.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openCheckEmail();
    await advance(4_000); // встроенные повторы запроса исчерпаны

    expect(screen.getByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(resendButton()).toBeOnTheScreen();

    poll.mockResolvedValue({ state: 'pending' });
    const calls = poll.mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(poll.mock.calls.length).toBeGreaterThan(calls);
  });

  it('опрос: ответ сервера 500 — «Не удалось загрузить», не «Нет соединения»', async () => {
    poll.mockRejectedValue(new ApiHttpError(500, null));
    await openCheckEmail();
    await advance(4_000);

    expect(screen.getByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });

  it('восстанавливается после перезапуска: адрес из SecureStore, повтор — после отсчёта', async () => {
    await openCheckEmail();

    expect(
      screen.getByText(new RegExp(`Мы отправили письмо на ${keepTogether(EMAIL)}`)),
    ).toBeOnTheScreen();
    expect(resendButton()).toBeDisabled();
    expect(screen.getByText('Повторно — через 1:00')).toBeOnTheScreen();

    await advance(18_000);
    expect(screen.getByText('Повторно — через 0:42')).toBeOnTheScreen();

    await advance(42_000);
    expect(screen.queryByText(/Повторно — через/)).toBeNull();
    expect(resendButton()).toBeEnabled();
  });

  it('повтор письма: баннер, статичная подпись «Отправить ещё раз» и новый отсчёт', async () => {
    resend.mockResolvedValue({ resendAvailableInSec: 60 });
    await openCheckEmail(0);

    await fireEvent.press(resendButton());

    expect(resend).toHaveBeenCalledWith({ registrationToken: REGISTRATION_TOKEN });
    expect(await screen.findByText('Письмо отправлено ещё раз.')).toBeOnTheScreen();
    expect(resendButton('Отправить ещё раз')).toBeDisabled();
    expect(screen.getByText('Повторно — через 1:00')).toBeOnTheScreen();
  });

  it('429 — пауза по retryAfterSec и предупреждение о лимите', async () => {
    resend.mockRejectedValue(
      new ApiHttpError(429, {
        code: 'RATE_LIMITED',
        message: 'limit',
        details: { retryAfterSec: 900 },
      }),
    );
    await openCheckEmail(0);

    await fireEvent.press(resendButton());

    expect(await screen.findByText('Слишком много писем. Попробуйте позже.')).toBeOnTheScreen();
    expect(screen.getByText('Повторно — через 15:00')).toBeOnTheScreen();
    expect(resendButton()).toBeDisabled();
  });

  it('сбой SecureStore после обмена — вход всё равно состоялся (токен регистрации уже погашен)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await openCheckEmail();
    const setItem = jest.mocked(SecureStore.setItemAsync);
    const original = setItem.getMockImplementation();
    setItem.mockRejectedValue(new Error('Keystore unavailable'));

    poll.mockResolvedValue({ state: 'verified', session });
    await advance(3000);
    await advance(1000);

    expect(await screen.findByRole('header', { name: 'Главная' })).toBeOnTheScreen();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session not persisted'));
    if (original) setItem.mockImplementation(original);
    warn.mockRestore();
  });

  it('опрос замечает подтверждение → «E-mail подтверждён» ~1 с → сессия в SecureStore → Главная', async () => {
    const router = await openCheckEmail();
    expect(poll).toHaveBeenCalledWith({ registrationToken: REGISTRATION_TOKEN });

    poll.mockResolvedValue({ state: 'verified', session });
    await advance(3000);

    expect(await screen.findByRole('header', { name: 'E-mail подтверждён' })).toBeOnTheScreen();
    expect(
      screen.getByText(`Входим в аккаунт ${keepTogether(EMAIL)} — пароль вводить заново не нужно.`),
    ).toBeOnTheScreen();
    // сессия сохранена сразу — закрытие приложения в эту секунду её не теряет
    expect(JSON.parse(storedValue('pokatim.session') ?? '{}')).toEqual(session);

    await advance(1000);
    expect(await screen.findByRole('header', { name: 'Главная' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(storedValue('pokatim.registration')).toBeUndefined();
  });

  it('401 опроса (токен истёк или уже обменян) — «Войдите в аккаунт» и переход ко входу', async () => {
    poll.mockRejectedValue(new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' }));
    const router = await renderRouterAfterRestart();

    expect(await screen.findByRole('header', { name: 'Войдите в аккаунт' })).toBeOnTheScreen();
    // срок токена по оценке клиента не истёк — значит, обменян: адрес подтверждён (R7)
    expect(screen.getByText('E-mail подтверждён. Войдите с паролем.')).toBeOnTheScreen();
    // 401 не повторяется
    await advance(10_000);
    expect(poll).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    expect(router.getPathname()).toBe('/sign-in');
    expect(storedValue('pokatim.registration')).toBeUndefined();
    // e-mail регистрации подставлен в форму входа
    expect(await screen.findByDisplayValue(EMAIL)).toBeOnTheScreen();
  });

  it('повтор вернул «уже подтверждён» — опрос сразу забирает сессию', async () => {
    resend.mockResolvedValue({ state: 'verified' });
    await openCheckEmail(0);
    poll.mockResolvedValue({ state: 'verified', session });

    await fireEvent.press(resendButton());
    expect(await screen.findByRole('header', { name: 'E-mail подтверждён' })).toBeOnTheScreen();
  });
});

async function renderRouterAfterRestart() {
  storePendingRegistration(NOW.getTime());
  return renderRouter(appRoutes, { initialUrl: '/' });
}
