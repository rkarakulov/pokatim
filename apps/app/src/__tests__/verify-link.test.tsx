/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { VerificationLinkInfo } from '@pokatim/contracts';
import { keepTogether } from '@rkarakulov/ui';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { api } from '@/lib/api';

import {
  EMAIL,
  LINK_TOKEN,
  NOW,
  REGISTRATION_TOKEN,
  session,
  storedValue,
  storePendingRegistration,
  storeSurveyCompleted,
} from './auth-fixtures';
import { appRoutes } from './app-routes';
import { useRegistrationStore } from '@/features/auth/registration-store';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getLink = jest.mocked(api.getVerificationLink);
const confirm = jest.mocked(api.confirmVerification);
const resend = jest.mocked(api.resendVerification);
const poll = jest.mocked(api.pollRegistration);

const openLink = () => renderRouter(appRoutes, { initialUrl: `/auth/verify/${LINK_TOKEN}` });
const httpError = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: code, details });

beforeEach(() => {
  // опрос онбординга уже пройден (кеш устройства): сценарии ведут на Главную; сам онбординг — onboarding-guard.test
  storeSurveyCompleted();
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('ссылка из письма', () => {
  it('загрузка — скелетон; открытие только читает ссылку (GET), без подтверждения', async () => {
    let resolve: (info: VerificationLinkInfo) => void = () => undefined;
    getLink.mockReturnValue(new Promise((done) => (resolve = done)));
    await openLink();

    expect(await screen.findByLabelText('Загрузка')).toBeOnTheScreen();
    // шапка сценария видна сразу, скелетон — только на месте данных (§4.12)
    expect(screen.getByText('Регистрация')).toBeOnTheScreen();
    await act(async () => resolve({ state: 'valid', email: EMAIL }));

    expect(await screen.findByRole('header', { name: 'Подтвердите e-mail' })).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(`Аккаунт ${keepTogether(EMAIL)}`))).toBeOnTheScreen();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('valid → «Подтвердить e-mail» (POST) → подтверждено; без регистрации здесь — вход по паролю с этим e-mail', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockResolvedValue({ state: 'verified', email: EMAIL });
    const router = await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Подтвердить e-mail' }));

    expect(confirm).toHaveBeenCalledWith({ token: LINK_TOKEN });
    expect(await screen.findByRole('header', { name: 'E-mail подтверждён' })).toBeOnTheScreen();
    expect(
      screen.getByText(`Адрес ${keepTogether(EMAIL)} подтверждён. Войдите с паролем.`),
    ).toBeOnTheScreen();
    expect(poll).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    expect(router.getPathname()).toBe('/sign-in');
    // e-mail — через память, не в адресе
    expect(await screen.findByDisplayValue(EMAIL)).toBeOnTheScreen();
  });

  it('регистрировались на этом устройстве: подтверждение → опрос → вход без пароля → Главная', async () => {
    jest.useFakeTimers({ now: NOW });
    storePendingRegistration(NOW.getTime());
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockResolvedValue({ state: 'verified', email: EMAIL });
    poll.mockResolvedValue({ state: 'verified', session });
    const router = await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Подтвердить e-mail' }));
    expect(
      await screen.findByText(new RegExp(`Входим в аккаунт ${keepTogether(EMAIL)}`)),
    ).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(await screen.findByRole('header', { name: 'Главная' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  it('подтверждено на этом устройстве, но опрос без сети — «Входим…» + «Нет соединения» с повтором', async () => {
    jest.useFakeTimers({ now: NOW });
    storePendingRegistration(NOW.getTime());
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockResolvedValue({ state: 'verified', email: EMAIL });
    poll.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Подтвердить e-mail' }));
    await act(() => jest.advanceTimersByTimeAsync(4_000));

    expect(
      screen.getByText(new RegExp(`Входим в аккаунт ${keepTogether(EMAIL)}`)),
    ).toBeOnTheScreen();
    expect(screen.getByText('Нет соединения')).toBeOnTheScreen();

    poll.mockResolvedValue({ state: 'verified', session });
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(await screen.findByRole('header', { name: 'Главная' })).toBeOnTheScreen();
  });

  it('«Ссылка устарела» на устройстве регистрации: живая регистрация продлевается после нового письма', async () => {
    jest.useFakeTimers({ now: NOW });
    storePendingRegistration(NOW.getTime() - 3600_000); // токен регистрации ещё жив 23 ч
    getLink.mockResolvedValue({ state: 'expired', email: EMAIL });
    resend.mockResolvedValue({ resendAvailableInSec: 60 });
    await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отправить новое письмо' }));
    await screen.findByText(`Новое письмо отправлено на ${keepTogether(EMAIL)}.`);
    // было «ещё 23 ч», стало «24 ч от нового письма»
    expect(
      JSON.parse(storedValue('pokatim.registration') ?? '{}').expiresAt,
    ).toBeGreaterThanOrEqual(NOW.getTime() + 24 * 3600_000);
  });

  it('«Ссылка устарела»: истёкшая регистрация в памяти не воскрешается (сервер её не продлевает)', async () => {
    jest.useFakeTimers({ now: NOW });
    getLink.mockResolvedValue({ state: 'expired', email: EMAIL });
    resend.mockResolvedValue({ resendAvailableInSec: 60 });
    await openLink();
    // приложение открыто с момента регистрации, срок токена регистрации уже прошёл
    const expiredAt = NOW.getTime() - 3600_000;
    useRegistrationStore.setState({
      pending: {
        registrationToken: REGISTRATION_TOKEN,
        email: EMAIL,
        resendAvailableAt: expiredAt,
        expiresAt: expiredAt,
      },
    });

    await fireEvent.press(await screen.findByRole('button', { name: 'Отправить новое письмо' }));
    await screen.findByText(`Новое письмо отправлено на ${keepTogether(EMAIL)}.`);
    expect(useRegistrationStore.getState().pending?.expiresAt).toBe(expiredAt);
    expect(storedValue('pokatim.registration')).toBeUndefined();
  });

  it('подтверждено на этом устройстве, опрос отвечает 500 — «Не удалось загрузить», не «Нет соединения»', async () => {
    jest.useFakeTimers({ now: NOW });
    storePendingRegistration(NOW.getTime());
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockResolvedValue({ state: 'verified', email: EMAIL });
    poll.mockRejectedValue(new ApiHttpError(500, null));
    await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Подтвердить e-mail' }));
    await act(() => jest.advanceTimersByTimeAsync(4_000));

    expect(screen.getByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });

  it('expired → «Ссылка устарела» с адресом → новое письмо по токену ссылки', async () => {
    getLink.mockResolvedValue({ state: 'expired', email: EMAIL });
    resend.mockResolvedValue({ resendAvailableInSec: 60 });
    await openLink();

    expect(await screen.findByRole('header', { name: 'Ссылка устарела' })).toBeOnTheScreen();
    expect(
      screen.getByText(new RegExp(`Отправим новое письмо на ${keepTogether(EMAIL)}`)),
    ).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Отправить новое письмо' }));
    expect(resend).toHaveBeenCalledWith({ linkToken: LINK_TOKEN });
    expect(
      await screen.findByText(`Новое письмо отправлено на ${keepTogether(EMAIL)}.`),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить новое письмо' })).toBeDisabled();
  });

  it('confirm ответил 410 LINK_EXPIRED — экран «Ссылка устарела» с адресом из ответа', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockRejectedValue(httpError(410, 'LINK_EXPIRED', { email: 'new@mail.by' }));
    await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Подтвердить e-mail' }));
    expect(await screen.findByRole('header', { name: 'Ссылка устарела' })).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(keepTogether('new@mail.by')))).toBeOnTheScreen();
  });

  it('404 — «Ссылка больше не действует» и переход к регистрации', async () => {
    getLink.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    const router = await openLink();

    expect(
      await screen.findByRole('header', { name: 'Ссылка больше не действует' }),
    ).toBeOnTheScreen();
    // 404 окончателен — без повторов запроса
    expect(getLink).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'К регистрации' }));
    expect(router.getPathname()).toBe('/register');
  });

  it('нет сети (NetInfo) — сразу «Нет соединения», без вечного скелетона; сеть вернулась — ссылка', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    onlineManager.setOnline(false);
    await openLink();

    expect(await screen.findByRole('header', { name: 'Нет соединения' })).toBeOnTheScreen();
    expect(getLink).not.toHaveBeenCalled();

    await act(async () => onlineManager.setOnline(true));
    expect(await screen.findByRole('button', { name: 'Подтвердить e-mail' })).toBeOnTheScreen();
  });

  it('запрос не дошёл — после повторов «Нет соединения»; «Повторить» загружает ссылку', async () => {
    jest.useFakeTimers({ now: NOW });
    getLink.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openLink();
    // повторы сетевой ошибки — с паузой (shouldRetry), затем ошибка
    await act(() => jest.advanceTimersByTimeAsync(10_000));

    expect(await screen.findByRole('header', { name: 'Нет соединения' })).toBeOnTheScreen();
    expect(getLink).toHaveBeenCalledTimes(3);

    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Подтвердить e-mail' })).toBeOnTheScreen();
  });

  it('confirm без сети — баннер у кнопки, кнопка снова доступна', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockRejectedValue(new ApiNetworkError(null));
    await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Подтвердить e-mail' }));
    expect(
      await screen.findByText('Нет соединения. Проверьте подключение к интернету и повторите.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Подтвердить e-mail' })).toBeEnabled();
  });
});
