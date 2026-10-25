/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { PasswordResetLinkInfo } from '@pokatim/contracts';
import { keepTogether } from '@rkarakulov/ui';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import {
  EMAIL,
  LINK_TOKEN,
  NOW,
  session,
  storedValue,
  storeSession,
  storeSurveyCompleted,
} from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getLink = jest.mocked(api.getPasswordResetLink);
const confirm = jest.mocked(api.confirmPasswordReset);
const request = jest.mocked(api.requestPasswordReset);
const NEW_PASSWORD = 'new-velo-secret';

const openLink = () => renderRouter(appRoutes, { initialUrl: `/auth/reset/${LINK_TOKEN}` });
const httpError = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: code, details });
const saveButton = () => screen.getByRole('button', { name: 'Сохранить пароль' });

async function fillPasswords(password = NEW_PASSWORD, repeat = password) {
  await fireEvent.changeText(await screen.findByLabelText('Новый пароль'), password);
  await fireEvent.changeText(screen.getByLabelText('Повторите пароль'), repeat);
}

beforeEach(() => {
  // опрос онбординга уже пройден (кеш устройства): сценарии ведут на Главную; сам онбординг — onboarding-guard.test
  storeSurveyCompleted();
  jest.mocked(api.signOut).mockResolvedValue(undefined);
  jest.mocked(api.refreshSession).mockResolvedValue(session);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('ссылка сброса пароля', () => {
  it('загрузка — скелетон на месте данных, кикер виден сразу; открытие только читает ссылку', async () => {
    let resolve: (info: PasswordResetLinkInfo) => void = () => undefined;
    getLink.mockReturnValue(new Promise((done) => (resolve = done)));
    await openLink();

    expect(await screen.findByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.getByText('Вход')).toBeOnTheScreen();
    await act(async () => resolve({ state: 'valid', email: EMAIL }));

    expect(await screen.findByRole('header', { name: 'Новый пароль' })).toBeOnTheScreen();
    expect(screen.getByText(`Аккаунт ${keepTogether(EMAIL)}.`)).toBeOnTheScreen();
    expect(getLink).toHaveBeenCalledWith(LINK_TOKEN);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('пароли не совпадают — ошибка у поля повтора, запроса нет; короткий — «Не короче 8 символов.»', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    await openLink();

    await fillPasswords(NEW_PASSWORD, 'другой-пароль');
    await fireEvent.press(saveButton());
    expect(await screen.findByText('Пароли не совпадают.')).toBeOnTheScreen();

    await fillPasswords('short');
    await fireEvent.press(saveButton());
    expect(await screen.findByText('Не короче 8 символов.')).toBeOnTheScreen();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('400 сервера по паролю — ошибка у поля, не баннером', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockRejectedValue(
      httpError(400, 'VALIDATION_FAILED', { fields: [{ path: 'password', code: 'TOO_LONG' }] }),
    );
    await openLink();
    await fillPasswords();

    await fireEvent.press(saveButton());

    expect(await screen.findByText('Слишком длинное значение.')).toBeOnTheScreen();
  });

  it('успех: кнопка busy → «Пароль изменён» → «Войти» → «Вход» с e-mail (через память)', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    let resolve: (value: { state: 'passwordChanged'; email: string }) => void = () => undefined;
    confirm.mockReturnValue(new Promise((done) => (resolve = done)));
    const router = await openLink();
    await fillPasswords();

    await fireEvent.press(saveButton());
    expect(saveButton()).toBeBusy();
    expect(confirm).toHaveBeenCalledWith({ token: LINK_TOKEN, password: NEW_PASSWORD });
    await act(async () => resolve({ state: 'passwordChanged', email: EMAIL }));

    expect(await screen.findByRole('header', { name: 'Пароль изменён' })).toBeOnTheScreen();
    expect(
      screen.getByText('Войдите с новым паролем. На других устройствах выполнен выход.'),
    ).toBeOnTheScreen();
    expect(api.signOut).not.toHaveBeenCalled(); // сессии на устройстве не было

    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    expect(router.getPathname()).toBe('/sign-in');
    expect(router.getSearchParams()).toEqual({});
    expect(await screen.findByDisplayValue(EMAIL)).toBeOnTheScreen();
  });

  it('сессия на этом устройстве — после смены пароля локальный выход (сервер, SecureStore)', async () => {
    jest.useFakeTimers({ now: NOW });
    storeSession();
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockResolvedValue({ state: 'passwordChanged', email: EMAIL });
    await openLink();
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(useSessionStore.getState().status).toBe('signedIn');
    await fillPasswords();

    await fireEvent.press(saveButton());

    expect(await screen.findByRole('header', { name: 'Пароль изменён' })).toBeOnTheScreen();
    expect(api.signOut).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().status).not.toBe('signedIn');
    expect(storedValue('pokatim.session')).toBeUndefined();
  });

  it('410 на сохранении — состояние перечитано: «Пароль уже изменён» → «Войти»', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockRejectedValue(httpError(410, 'LINK_EXPIRED', { email: EMAIL }));
    const router = await openLink();
    await fillPasswords();
    getLink.mockResolvedValue({ state: 'used', email: EMAIL });

    await fireEvent.press(saveButton());

    expect(await screen.findByRole('header', { name: 'Пароль уже изменён' })).toBeOnTheScreen();
    expect(getLink).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText('По этой ссылке пароль уже сменили. Войдите с новым паролем.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
    expect(router.getPathname()).toBe('/sign-in');
    expect(await screen.findByDisplayValue(EMAIL)).toBeOnTheScreen();
  });

  it('ответ смены потерялся, сессия на устройстве: повтор 410 → used → «Войти» — локальный выход и «Вход» с e-mail', async () => {
    jest.useFakeTimers({ now: NOW });
    storeSession();
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    // пароль на сервере уже сменён, ответ первого запроса потерялся — повтор получает 410
    confirm.mockRejectedValue(httpError(410, 'LINK_EXPIRED', { email: EMAIL }));
    const router = await openLink();
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(useSessionStore.getState().status).toBe('signedIn');
    await fillPasswords();
    getLink.mockResolvedValue({ state: 'used', email: EMAIL });

    await fireEvent.press(saveButton());
    expect(await screen.findByRole('header', { name: 'Пароль уже изменён' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByDisplayValue(EMAIL)).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expect(api.signOut).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().status).not.toBe('signedIn');
    expect(storedValue('pokatim.session')).toBeUndefined();
  });

  it('«Пароль изменён» — вне загрузки ссылки: после выхода (кеш очищен) GET не повторяется, экран не пропадает', async () => {
    jest.useFakeTimers({ now: NOW });
    storeSession();
    getLink.mockResolvedValueOnce({ state: 'valid', email: EMAIL });
    confirm.mockResolvedValue({ state: 'passwordChanged', email: EMAIL });
    await openLink();
    await act(() => jest.advanceTimersByTimeAsync(0));
    await fillPasswords();
    // после выхода ссылка больше не читается: повторный GET висел бы или падал
    getLink.mockReturnValue(new Promise(() => undefined));

    await fireEvent.press(saveButton());
    await act(() => jest.advanceTimersByTimeAsync(1000));

    expect(screen.getByRole('header', { name: 'Пароль изменён' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Загрузка')).toBeNull();
    expect(getLink).toHaveBeenCalledTimes(1);
    expect(api.signOut).toHaveBeenCalledTimes(1);
  });

  it('410 на сохранении, ссылка заменена — «Ссылка устарела»', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockRejectedValue(httpError(410, 'LINK_EXPIRED', { email: EMAIL }));
    await openLink();
    await fillPasswords();
    getLink.mockResolvedValue({ state: 'expired', email: EMAIL });

    await fireEvent.press(saveButton());

    expect(await screen.findByRole('header', { name: 'Ссылка устарела' })).toBeOnTheScreen();
  });

  it('expired → «Отправить новую ссылку» на e-mail из ответа: баннер и отсчёт; «Вернуться ко входу»', async () => {
    getLink.mockResolvedValue({ state: 'expired', email: EMAIL });
    request.mockResolvedValue({ resendAvailableInSec: 60 });
    const router = await openLink();

    expect(await screen.findByRole('header', { name: 'Ссылка устарела' })).toBeOnTheScreen();
    expect(
      screen.getByText(`Ссылка действует 1 час. Отправим новую на ${keepTogether(EMAIL)}.`),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить новую ссылку' }));

    expect(request).toHaveBeenCalledWith({ email: EMAIL });
    expect(
      await screen.findByText(`Новая ссылка отправлена на ${keepTogether(EMAIL)}.`),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить новую ссылку' })).toBeDisabled();
    expect(screen.getByText('Повторно — через 1:00')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Вернуться ко входу' }));
    expect(router.getPathname()).toBe('/sign-in');
  });

  it('expired, 429 на новой ссылке — предупреждение и отсчёт', async () => {
    getLink.mockResolvedValue({ state: 'expired', email: EMAIL });
    request.mockRejectedValue(httpError(429, 'RATE_LIMITED', { retryAfterSec: 30 }));
    await openLink();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отправить новую ссылку' }));

    expect(await screen.findByText('Слишком много писем. Попробуйте позже.')).toBeOnTheScreen();
    expect(screen.getByText('Повторно — через 0:30')).toBeOnTheScreen();
  });

  it('404 — «Ссылка больше не действует» → «Вернуться ко входу»', async () => {
    getLink.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    const router = await openLink();

    expect(
      await screen.findByRole('header', { name: 'Ссылка больше не действует' }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Запросите восстановление пароля ещё раз.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Вернуться ко входу' }));
    expect(router.getPathname()).toBe('/sign-in');
  });

  it('запрос не дошёл — «Нет соединения» с повтором; «Повторить» загружает ссылку', async () => {
    jest.useFakeTimers({ now: NOW });
    getLink.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openLink();
    await act(() => jest.advanceTimersByTimeAsync(10_000));

    expect(await screen.findByRole('header', { name: 'Нет соединения' })).toBeOnTheScreen();

    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('header', { name: 'Новый пароль' })).toBeOnTheScreen();
  });

  it('сохранение без сети — баннер у кнопки, кнопка снова доступна', async () => {
    getLink.mockResolvedValue({ state: 'valid', email: EMAIL });
    confirm.mockRejectedValue(new ApiNetworkError(null));
    await openLink();
    await fillPasswords();

    await fireEvent.press(saveButton());

    expect(
      await screen.findByText('Нет соединения. Проверьте подключение к интернету и повторите.'),
    ).toBeOnTheScreen();
    expect(saveButton()).toBeEnabled();
  });
});
