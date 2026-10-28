/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import * as returnPath from '@/features/auth/return-path';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { EMAIL, liveSession, session, storeSession, storeSurveyCompleted } from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');

const deleteAccount = jest.mocked(api.deleteAccount);
const PATH = '/settings/account/delete';
const PASSWORD = 'Текущий пароль';
const submit = () => screen.getByRole('button', { name: 'Удалить навсегда' });
const apiError = (status: number, code: string, details?: unknown) =>
  new ApiHttpError(status, { code, message: code, details });

beforeEach(() => {
  jest.mocked(api.pollRegistration).mockResolvedValue({ state: 'pending' });
  jest.mocked(api.signOut).mockResolvedValue(undefined);
  // фоновая проверка сессии после запуска — сессия жива (ответ — та же сессия)
  jest.mocked(api.refreshSession).mockResolvedValue(liveSession);
  // Главная после входа гостя
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listRides).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.getProfile).mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
  });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

/** Вошедший пользователь (сессия прошлого запуска, опрос пройден) открывает экран удаления. */
async function openSignedIn() {
  storeSession(liveSession);
  storeSurveyCompleted();
  const router = await renderRouter(appRoutes, { initialUrl: PATH });
  await screen.findByRole('header', { name: 'Удаление аккаунта' });
  return router;
}

async function confirmWith(password = 'velo-secret') {
  await fireEvent.changeText(screen.getByLabelText(PASSWORD), password);
  await fireEvent.press(submit());
}

describe('«Удаление аккаунта»: экран (AC8)', () => {
  it('заголовок, последствия A3–A8, поле пароля (secure), «Удалить навсегда» выключена без пароля, «Назад»', async () => {
    await openSignedIn();

    expect(screen.getByText('Аккаунт удаляется сразу. Восстановить его нельзя.')).toBeOnTheScreen();
    for (const consequence of [
      'Вы выйдете из аккаунта на всех устройствах.',
      'Заезды, треки, исходные файлы и «Мои маршруты» удалятся.',
      'Ваше имя пропадёт из таблиц результатов — там вы станете «Участник». Опубликованные протоколы не изменятся.',
      'Открытые споры решит модератор без вашего ответа.',
      'Ваши будущие кофе-райды отменятся, отметки «Иду» в чужих райдах снимутся.',
      'Подключения Garmin и Wahoo будут отозваны.',
      'Этот e-mail нельзя будет использовать для новой регистрации.',
    ]) {
      expect(screen.getByText(consequence)).toBeOnTheScreen();
    }
    // последствия — список: контейнер list, у пунктов роль listitem (web — ul/li)
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByLabelText(PASSWORD)).toHaveProp('secureTextEntry', true);
    expect(screen.getByLabelText(PASSWORD)).toHaveProp('autoComplete', 'current-password');
    expect(submit()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Назад' })).toBeOnTheScreen();
  });

  it('«Назад» без истории — «Профиль»', async () => {
    const router = await openSignedIn();
    await fireEvent.press(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() => expect(router.getPathname()).toBe('/settings/profile'));
  });

  it('пока сессия неизвестна (SSR, запуск) — скелетон оболочки, без формы и редиректа', async () => {
    const never = new Promise<string | null>(() => undefined);
    jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(never).mockReturnValueOnce(never);
    const router = await renderRouter(appRoutes, { initialUrl: PATH });

    expect(await screen.findByRole('progressbar', { name: 'Загрузка' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe(PATH);
    expect(screen.queryByLabelText(PASSWORD)).toBeNull();
  });

  it('успех: пароль — в запросе; кнопка занята; выход без «возврата на вход» → «Регистрация» с «Аккаунт удалён»', async () => {
    let resolve: () => void = () => undefined;
    deleteAccount.mockReturnValue(
      new Promise<undefined>((done) => {
        resolve = () => done(undefined);
      }),
    );
    const router = await openSignedIn();

    await confirmWith('velo-secret');
    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith(liveSession.accessToken, {
        password: 'velo-secret',
      }),
    );
    expect(submit()).toBeDisabled();
    await act(async () => resolve());

    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
    expect(screen.getByText('Аккаунт удалён')).toBeOnTheScreen();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedOut',
      session: null,
      returning: false,
    });
    // устройство забыло сессию; сервер уже отозвал все сессии — отдельного sign-out нет
    expect(await SecureStore.getItemAsync('pokatim.session')).toBeNull();
    expect(api.signOut).not.toHaveBeenCalled();
  });

  it('неверный пароль (403) — ошибка под полем, сессия жива, без баннера', async () => {
    deleteAccount.mockRejectedValue(apiError(403, 'PASSWORD_INCORRECT'));
    const router = await openSignedIn();

    await confirmWith('wrong-pass');

    expect(await screen.findByText('Неверный пароль.')).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(router.getPathname()).toBe(PATH);
    expect(api.signOut).not.toHaveBeenCalled();
  });

  it.each([
    [
      'член команды панели (409)',
      apiError(409, 'ACCOUNT_PANEL_MEMBER'),
      'Вы в команде панели — попросите администратора снять роль.',
    ],
    [
      'нет сети',
      new ApiNetworkError(new TypeError('Network request failed')),
      'Нет соединения. Проверьте подключение к интернету и повторите.',
    ],
    ['сбой API', apiError(500, 'INTERNAL'), 'Что-то пошло не так. Попробуйте ещё раз.'],
  ])('%s — баннер (роль alert, живой регион); сессия жива', async (_case, error, text) => {
    deleteAccount.mockRejectedValue(error);
    await openSignedIn();

    await confirmWith();

    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toBeOnTheScreen();
    expect(screen.getByTestId('account-delete-errors')).toHaveProp(
      'accessibilityLiveRegion',
      'assertive',
    );
    expect(useSessionStore.getState().status).toBe('signedIn');
  });

  it('лимит (429) — баннер с отсчётом, кнопка выключена до конца паузы', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    deleteAccount.mockRejectedValue(apiError(429, 'RATE_LIMITED', { retryAfterSec: 90 }));
    await openSignedIn();

    await confirmWith();

    expect(
      await screen.findByText('Слишком много попыток. Попробуйте через 1:30.'),
    ).toBeOnTheScreen();
    expect(submit()).toBeDisabled();
    await act(() => jest.advanceTimersByTimeAsync(91_000));
    expect(screen.queryByText(/Слишком много попыток/)).toBeNull();
    expect(submit()).toBeEnabled();
  });

  it('сервер отклонил поле (400) — текст под полем по коду', async () => {
    deleteAccount.mockRejectedValue(
      apiError(400, 'VALIDATION_FAILED', { fields: [{ path: 'password', code: 'TOO_LONG' }] }),
    );
    await openSignedIn();
    await confirmWith();
    expect(await screen.findByText('Слишком длинное значение.')).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('«Удаление аккаунта»: гость (A12)', () => {
  it('гость → «Вход» с запомненным путём; после входа — снова экран удаления', async () => {
    const remember = jest.spyOn(returnPath, 'rememberReturnPath');
    storeSurveyCompleted();
    jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session });
    const router = await renderRouter(appRoutes, { initialUrl: PATH });

    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
    expect(remember).toHaveBeenCalledWith(PATH);

    await fireEvent.changeText(screen.getByLabelText('E-mail'), EMAIL);
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(router.getPathname()).toBe(PATH));
    expect(await screen.findByRole('header', { name: 'Удаление аккаунта' })).toBeOnTheScreen();
    expect(deleteAccount).not.toHaveBeenCalled();
    remember.mockRestore();
  });
});
