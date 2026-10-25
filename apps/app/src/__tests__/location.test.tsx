/// <reference types="jest" />
import * as Location from 'expo-location';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/lib/api';

import { liveSession, storedValue, storeSession, storeSurveyCompleted } from './auth-fixtures';
import { appRoutes } from './app-routes';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getPermission = jest.mocked(Location.getForegroundPermissionsAsync);
const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const permission = (status: string) => ({ status }) as Location.LocationPermissionResponse;
const secureStore = () =>
  jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
const locationFlag = () => secureStore().get('pokatim.locationPrompt');
const locationTitle = () => screen.findByRole('header', { name: 'Покажем, что рядом' });
const home = () => screen.findByRole('header', { name: 'Главная' });

beforeEach(() => {
  jest.mocked(api.signOut).mockResolvedValue(undefined);
  jest.mocked(api.refreshSession).mockReset();
  getPermission.mockResolvedValue(permission('undetermined'));
  requestPermission.mockResolvedValue(permission('granted'));
});
afterEach(() => {
  jest.clearAllMocks();
});

/** Вошедший пользователь с пройденным опросом. */
function signedInWithSurvey() {
  storeSession(liveSession);
  storeSurveyCompleted();
}

describe('шаг геопозиции (AC7)', () => {
  it('после опроса, разрешение не определено → экран геопозиции, вкладок нет', async () => {
    storeSession(liveSession);
    jest.mocked(api.getOnboardingStatus).mockResolvedValue({ surveyCompleted: false });
    jest.mocked(api.submitOnboardingSurvey).mockResolvedValue({ surveyCompleted: true });
    const router = await renderRouter(appRoutes, { initialUrl: '/' });

    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Новые маршруты' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Продолжить' }));

    expect(await locationTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/location');
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();
  });

  it('«Разрешить» → системный запрос → Главная; флаг устройства; координаты не читаются', async () => {
    signedInWithSurvey();
    const router = await renderRouter(appRoutes, { initialUrl: '/' });
    expect(await locationTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/location');

    await fireEvent.press(screen.getByRole('button', { name: 'Разрешить' }));

    expect(await home()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(JSON.parse(locationFlag() ?? '{}')).toMatchObject({ decision: 'requested' });
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it.each(['denied', 'undetermined'])(
    '«Разрешить», ответ ОС %s → всё равно Главная',
    async (status) => {
      signedInWithSurvey();
      requestPermission.mockResolvedValue(permission(status));
      await renderRouter(appRoutes, { initialUrl: '/' });
      await fireEvent.press(await screen.findByRole('button', { name: 'Разрешить' }));
      expect(await home()).toBeOnTheScreen();
    },
  );

  it('сбой системного запроса — как «недоступно»: Главная', async () => {
    signedInWithSurvey();
    requestPermission.mockRejectedValue(new Error('E_LOCATION_UNAVAILABLE'));
    await renderRouter(appRoutes, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Разрешить' }));
    expect(await home()).toBeOnTheScreen();
  });

  it('«Не сейчас» → Главная без системного запроса; флаг устройства', async () => {
    signedInWithSurvey();
    await renderRouter(appRoutes, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Не сейчас' }));

    expect(await home()).toBeOnTheScreen();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(JSON.parse(locationFlag() ?? '{}')).toMatchObject({ decision: 'dismissed' });
  });

  it('повторный запуск с флагом устройства — экран не показывается', async () => {
    signedInWithSurvey();
    secureStore().set(
      'pokatim.locationPrompt',
      JSON.stringify({ decision: 'dismissed', at: Date.now() }),
    );
    await renderRouter(appRoutes, { initialUrl: '/location' });

    expect(await home()).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Покажем, что рядом' })).toBeNull();
  });

  it.each(['granted', 'denied'])('разрешение уже %s — шаг пропускается молча', async (status) => {
    signedInWithSurvey();
    getPermission.mockResolvedValue(permission(status));
    const router = await renderRouter(appRoutes, { initialUrl: '/location' });

    expect(await home()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(locationFlag()).toBeUndefined();
  });

  it('модуль геопозиции недоступен — шаг пропускается', async () => {
    signedInWithSurvey();
    getPermission.mockRejectedValue(new Error('unavailable'));
    await renderRouter(appRoutes, { initialUrl: '/' });
    expect(await home()).toBeOnTheScreen();
  });
});

describe('выход и другой аккаунт (AC8)', () => {
  it('флаг опроса стёрт, флаг геопозиции остался: следующий аккаунт экран геопозиции не видит', async () => {
    signedInWithSurvey();
    await renderRouter(appRoutes, { initialUrl: '/' });
    await fireEvent.press(await screen.findByRole('button', { name: 'Не сейчас' }));
    await home();

    await fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));
    await screen.findByRole('header', { name: 'Вход' });
    await waitFor(() => expect(storedValue('pokatim.onboarding')).toBeUndefined());
    expect(locationFlag()).toBeDefined();

    jest.mocked(api.getOnboardingStatus).mockResolvedValue({ surveyCompleted: true });
    jest.mocked(api.signIn).mockResolvedValue({ state: 'signedIn', session: liveSession });
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'other@mail.by');
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'velo-secret');
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));

    expect(await home()).toBeOnTheScreen();
    expect(api.getOnboardingStatus).toHaveBeenCalledWith(liveSession.accessToken);
    expect(screen.queryByRole('header', { name: 'Покажем, что рядом' })).toBeNull();
  });
});
