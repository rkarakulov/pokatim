/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { OnboardingStatus, SignInResponse } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { api } from '@/lib/api';

import {
  EMAIL,
  liveSession,
  liveSessionB,
  NOW,
  REGISTRATION_TOKEN,
  storedValue,
  storePendingRegistration,
  storeSession,
  storeSurveyCompleted,
  session,
} from './auth-fixtures';
import { USER_A, USER_B } from './jwt';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');

const status = jest.mocked(api.getOnboardingStatus);
const submit = jest.mocked(api.submitOnboardingSurvey);
const surveyTitle = () => screen.findByRole('header', { name: 'Что вас привело?' });
const continueButton = () => screen.getByRole('button', { name: 'Продолжить' });
const option = (name: string) => screen.getByRole('checkbox', { name });

beforeEach(() => {
  jest.mocked(api.signOut).mockResolvedValue(undefined);
  // фоновая ротация при запуске: ответ без сессии — «не проверено», остаёмся в аккаунте
  jest.mocked(api.refreshSession).mockReset();
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

/** Вошедший пользователь (сессия прошлого запуска с живым access). */
async function openSignedIn(path = '/', answer: OnboardingStatus = { surveyCompleted: false }) {
  storeSession(liveSession);
  status.mockResolvedValue(answer);
  return renderRouter(appRoutes, { initialUrl: path });
}

describe('гард онбординга: опрос после входа (AC6)', () => {
  it('вход по паролю без ответа → «Что вас привело?», вкладок нет; access — Bearer в запрос статуса', async () => {
    status.mockResolvedValue({ surveyCompleted: false });
    jest.mocked(api.signIn).mockResolvedValue({
      state: 'signedIn',
      session: liveSession,
    } satisfies SignInResponse);
    const router = await renderRouter(appRoutes, { initialUrl: '/sign-in' });
    await fireEvent.changeText(await screen.findByLabelText('E-mail'), EMAIL);
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    expect(await surveyTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/survey');
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
    expect(status).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it('автовход после подтверждения (V-09): «E-mail подтверждён» + «Дальше — короткий опрос» → опрос', async () => {
    jest.useFakeTimers({ now: NOW });
    storePendingRegistration(NOW.getTime());
    jest
      .mocked(api.pollRegistration)
      .mockResolvedValue({ state: 'verified', session: liveSession });
    status.mockResolvedValue({ surveyCompleted: false });
    const router = await renderRouter(appRoutes, { initialUrl: '/check-email' });

    expect(await screen.findByText('Дальше — короткий опрос.')).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(await surveyTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/survey');
    expect(REGISTRATION_TOKEN).toHaveLength(43);
  });

  it('ответ уже есть на сервере → Главная, кеш «опрос пройден» записан с владельцем', async () => {
    const router = await openSignedIn('/', { surveyCompleted: true });

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(JSON.parse(storedValue('pokatim.onboarding') ?? '{}')).toEqual({
      surveyCompleted: true,
      userId: USER_A,
    });
  });

  it('/ без ответа → опрос; /survey после ответа → Главная', async () => {
    const router = await openSignedIn('/');
    expect(await surveyTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/survey');
  });

  it('/survey с пройденным опросом → Главная', async () => {
    storeSurveyCompleted();
    const router = await openSignedIn('/survey');
    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  it('/survey без сессии → регистрация, опрос недоступен', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: '/survey' });
    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
  });

  it('/survey, пока сессия не прочитана (SSR, запуск), — скелетон оболочки без редиректа', async () => {
    // и сессия, и регистрация ещё читаются из хранилища
    const never = new Promise<string | null>(() => undefined);
    jest.mocked(SecureStore.getItemAsync).mockReturnValueOnce(never).mockReturnValueOnce(never);
    const router = await renderRouter(appRoutes, { initialUrl: '/survey' });

    expect(await screen.findByRole('progressbar', { name: 'Загрузка' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/survey');
    expect(screen.queryByRole('header', { name: 'Что вас привело?' })).toBeNull();
  });

  it('пока онбординг неизвестен — скелетон оболочки, без опроса и вкладок', async () => {
    storeSession(liveSession);
    status.mockReturnValue(new Promise(() => undefined));
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByRole('progressbar', { name: 'Загрузка' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(screen.queryByRole('header', { name: 'Что вас привело?' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', new ApiHttpError(503, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('статус не получен (%s) — ошибка с повтором; повтор → опрос', async (_case, error, title) => {
    storeSession(liveSession);
    status.mockRejectedValueOnce(error).mockResolvedValue({ surveyCompleted: false });
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByText(title)).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await surveyTitle()).toBeOnTheScreen();
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('офлайн-старт с кешем опроса — сразу Главная, сервер не спрашивается', async () => {
    storeSession(liveSession);
    storeSurveyCompleted();
    jest
      .mocked(api.refreshSession)
      .mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(status).not.toHaveBeenCalled();
  });
});

describe('экран «Что вас привело?»', () => {
  it('варианты — чекбоксы для скринридера; «Продолжить» выключена до первого выбора', async () => {
    await openSignedIn('/survey');
    await surveyTitle();

    for (const name of [
      'Гонки и результаты',
      'Кофе-райды и катание в компании',
      'Новые маршруты',
      'Календарь стартов',
      'Пока просто смотрю',
    ]) {
      expect(option(name)).not.toBeChecked();
    }
    expect(continueButton()).toBeDisabled();

    await fireEvent.press(option('Новые маршруты'));
    expect(option('Новые маршруты')).toBeChecked();
    expect(continueButton()).toBeEnabled();

    await fireEvent.press(option('Новые маршруты'));
    expect(continueButton()).toBeDisabled();
  });

  it('сохранение: кнопка busy, ответ в порядке экрана → Главная; кеш опроса записан', async () => {
    let resolve: (value: OnboardingStatus) => void = () => undefined;
    submit.mockReturnValue(new Promise((done) => (resolve = done)));
    const router = await openSignedIn('/survey');
    await surveyTitle();

    await fireEvent.press(option('Пока просто смотрю'));
    await fireEvent.press(option('Гонки и результаты'));
    await fireEvent.press(continueButton());

    await waitFor(() => expect(continueButton()).toBeBusy());
    expect(submit).toHaveBeenCalledWith(liveSession.accessToken, {
      reasons: ['races', 'exploring'],
    });
    await act(async () => resolve({ surveyCompleted: true }));
    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(storedValue('pokatim.onboarding')).toBeDefined();
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), /Нет соединения/],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), /Не удалось сохранить/],
  ])('ошибка сохранения (%s) — баннер, повтор той же кнопкой', async (_case, error, text) => {
    submit.mockRejectedValueOnce(error).mockResolvedValue({ surveyCompleted: true });
    await openSignedIn('/survey');
    await surveyTitle();

    await fireEvent.press(option('Календарь стартов'));
    await fireEvent.press(continueButton());
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(option('Календарь стартов')).toBeChecked();

    await fireEvent.press(continueButton());
    expect(await screen.findByRole('header', { name: 'Покатим' })).toBeOnTheScreen();
  });

  it('401 и refresh 401 — сессии нет: «Вход»', async () => {
    submit.mockRejectedValue(new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' }));
    const router = await openSignedIn('/survey');
    await surveyTitle();
    // сессию отозвали на сервере уже после запуска: refresh тоже 401
    jest
      .mocked(api.refreshSession)
      .mockRejectedValue(new ApiHttpError(401, { code: 'UNAUTHORIZED', message: 'x' }));

    await fireEvent.press(option('Календарь стартов'));
    await fireEvent.press(continueButton());

    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/sign-in');
  });
});

describe('кеш «опрос пройден» привязан к владельцу сессии', () => {
  it('кеш другого аккаунта игнорируется: сервер спрашивается, показывается опрос', async () => {
    storeSurveyCompleted(USER_B);
    const router = await openSignedIn('/');

    expect(await surveyTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/survey');
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('холодный старт с истёкшей сессией A и её кешем → вход аккаунтом B: опрос по ответу сервера для B', async () => {
    storeSession({ ...session, refreshTokenExpiresAt: '2020-01-01T00:00:00.000Z' });
    storeSurveyCompleted();
    status.mockResolvedValue({ surveyCompleted: false });
    jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session: liveSessionB });
    const router = await renderRouter(appRoutes, { initialUrl: '/sign-in' });
    await fireEvent.changeText(await screen.findByLabelText('E-mail'), 'b@mail.by');
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    expect(await surveyTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/survey');
    expect(status).toHaveBeenCalledWith(liveSessionB.accessToken);
  });
});

describe('выход и другой аккаунт (AC8)', () => {
  it('выход стирает кеш опроса: следующий вход спрашивает сервер о своём ответе', async () => {
    await openSignedIn('/', { surveyCompleted: true });
    await screen.findByRole('header', { name: 'Покатим' });
    expect(storedValue('pokatim.onboarding')).toBeDefined();

    // «Выйти» — в «Настройках» (settings-hub)
    await fireEvent.press(screen.getByRole('button', { name: 'Настройки' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Выйти' }));
    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(storedValue('pokatim.onboarding')).toBeUndefined();

    status.mockResolvedValue({ surveyCompleted: false });
    jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session: liveSession });
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'other@mail.by');
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    expect(await surveyTitle()).toBeOnTheScreen();
    expect(status).toHaveBeenCalledTimes(2);
  });
});
