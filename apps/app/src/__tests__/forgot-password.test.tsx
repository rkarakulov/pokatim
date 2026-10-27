/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RequestPasswordResetResponse } from '@pokatim/contracts';
import { keepTogether } from '@rkarakulov/ui';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { onlineManager } from '@tanstack/react-query';

import { useRegistrationStore } from '@/features/auth/registration-store';
import { api } from '@/lib/api';

import { EMAIL, NOW } from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');

const request = jest.mocked(api.requestPasswordReset);
const sendButton = () => screen.getByRole('button', { name: 'Отправить ссылку' });
const rateLimited = (retryAfterSec: number) =>
  new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'limit', details: { retryAfterSec } });
const SENT_MESSAGE = `Если аккаунт с адресом ${keepTogether(EMAIL)} есть, мы отправили на него ссылку. Она действует 1 час. Письма нет — проверьте «Спам».`;

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

async function openForgot() {
  const router = await renderRouter(appRoutes, { initialUrl: '/forgot-password' });
  await screen.findByRole('header', { name: 'Восстановление пароля' });
  return router;
}

describe('«Забыли пароль?»', () => {
  it('со «Входа» — экран запроса с e-mail из формы входа (через память, не URL)', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/sign-in' });
    await screen.findByRole('header', { name: 'Вход' });
    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);

    await fireEvent.press(screen.getByRole('button', { name: 'Забыли пароль?' }));

    expect(await screen.findByRole('header', { name: 'Восстановление пароля' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/forgot-password');
    expect(router.getSearchParams()).toEqual({});
    expect(screen.getByText('Вход')).toBeOnTheScreen(); // кикер сценария
    expect(screen.getByDisplayValue(EMAIL)).toBeOnTheScreen();
  });

  it('успех: кнопка busy на время запроса → «Проверьте почту» с нейтральным текстом и отсчётом повтора', async () => {
    jest.useFakeTimers({ now: NOW });
    let resolve: (value: RequestPasswordResetResponse) => void = () => undefined;
    request.mockReturnValue(new Promise((done) => (resolve = done)));
    await openForgot();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), ` ${EMAIL} `);

    await fireEvent.press(sendButton());
    expect(sendButton()).toBeBusy();
    expect(request).toHaveBeenCalledWith({ email: EMAIL });
    await act(async () => resolve({ resendAvailableInSec: 60 }));

    expect(await screen.findByRole('header', { name: 'Проверьте почту' })).toBeOnTheScreen();
    expect(screen.getByText(SENT_MESSAGE)).toBeOnTheScreen();
    const resend = screen.getByRole('button', { name: 'Отправить ещё раз' });
    expect(resend).toBeDisabled();
    expect(screen.getByText('Повторно — через 1:00')).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTimeAsync(60_000));
    request.mockResolvedValue({ resendAvailableInSec: 60 });
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить ещё раз' }));
    expect(request).toHaveBeenLastCalledWith({ email: EMAIL });
    expect(await screen.findByText('Повторно — через 1:00')).toBeOnTheScreen();
  });

  it('429 на запросе — предупреждение и отсчёт по retryAfterSec, кнопка выключена', async () => {
    request.mockRejectedValue(rateLimited(40));
    await openForgot();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);

    await fireEvent.press(sendButton());

    expect(await screen.findByText('Слишком много писем. Попробуйте позже.')).toBeOnTheScreen();
    expect(screen.getByText('Повторно — через 0:40')).toBeOnTheScreen();
    expect(sendButton()).toBeDisabled();
  });

  it('429 на повторе — отсчёт по retryAfterSec', async () => {
    jest.useFakeTimers({ now: NOW });
    request.mockResolvedValue({ resendAvailableInSec: 60 });
    await openForgot();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
    await fireEvent.press(sendButton());
    await screen.findByRole('header', { name: 'Проверьте почту' });
    await act(() => jest.advanceTimersByTimeAsync(60_000));

    request.mockRejectedValue(rateLimited(900));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить ещё раз' }));

    expect(await screen.findByText('Слишком много писем. Попробуйте позже.')).toBeOnTheScreen();
    expect(screen.getByText('Повторно — через 15:00')).toBeOnTheScreen();
  });

  it('устройство офлайн — запрос уходит, баннер «Нет соединения», кнопка снова доступна', async () => {
    request.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openForgot();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
    onlineManager.setOnline(false);

    await fireEvent.press(sendButton());

    expect(
      await screen.findByText('Нет соединения. Проверьте подключение к интернету и повторите.'),
    ).toBeOnTheScreen();
    expect(request).toHaveBeenCalledTimes(1);
    expect(sendButton()).toBeEnabled();
  });

  it('неверный e-mail — ошибка у поля, запроса нет', async () => {
    await openForgot();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'ivan@');

    await fireEvent.press(sendButton());

    expect(await screen.findByText('Проверьте e-mail: в адресе ошибка.')).toBeOnTheScreen();
    expect(request).not.toHaveBeenCalled();
  });

  it('«Вернуться ко входу» — на «Вход» с введённым e-mail', async () => {
    const router = await openForgot();
    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);

    await fireEvent.press(screen.getByRole('button', { name: 'Вернуться ко входу' }));

    expect(router.getPathname()).toBe('/sign-in');
    expect(useRegistrationStore.getState().draft.email).toBe(EMAIL);
    expect(await screen.findByDisplayValue(EMAIL)).toBeOnTheScreen();
  });
});
