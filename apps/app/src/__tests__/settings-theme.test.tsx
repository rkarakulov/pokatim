/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { APP_THEME_IDS, type AppThemeId, type ProfileView } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { resetSessionStore, useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { appRoutes } from './app-routes';
import { liveSession, signInForTest, storeSession, storeSurveyCompleted } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import ThemeScreen from '../app/settings/theme';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);
const setProfileTheme = jest.mocked(api.setProfileTheme);
const never = () => new Promise<never>(() => undefined);
const hidden = { includeHiddenElements: true };

const profile = (themeId: AppThemeId = 'classic'): ProfileView => ({
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  club: null,
  avatar: null,
  publicId: null,
  themeId,
  avatarUploadBlockedUntil: null,
  showRouteRides: false,
});

const nameOf = (id: AppThemeId) => t(`theme.${id}.name`);
// фон экрана — роль активной темы корня (светлая схема jest; у «всегда тёмных» — тёмная)
const surfaceOf = (id: AppThemeId) =>
  (appThemes[id].colorScheme === 'dark' ? appThemes[id].schemes.dark : appThemes[id].schemes.light)
    .surface.default;

beforeEach(() => {
  // вошедший с пройденным онбордингом, запуск через корневой layout: тема корня — из профиля
  storeSession(liveSession);
  storeSurveyCompleted();
  getProfile.mockResolvedValue(profile());
});
afterEach(() => jest.clearAllMocks());

const open = () => renderRouter(appRoutes, { initialUrl: '/settings/theme' });
// экран без корня: клиент запросов без повторов — ошибка видна сразу (у корня — повторы клиента приложения)
const openScreen = () => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  return renderRouter(
    { 'settings/theme': ThemeScreen },
    { initialUrl: '/settings/theme', wrapper: createQueryWrapper() },
  );
};
const list = async () => within(await screen.findByTestId('theme-list'));

describe('«Тема» (user-theme AC1)', () => {
  it('заголовок, пояснение; 7 тем — радио с названием, описанием и превью; текущая отмечена', async () => {
    getProfile.mockResolvedValue(profile('journal'));
    await open();
    expect(await screen.findByRole('header', { name: 'Тема' })).toBeOnTheScreen();
    expect(screen.getByText(t('settings.theme.lead'))).toBeOnTheScreen();

    const themes = await list();
    const radios = themes.getAllByRole('radio');
    expect(radios.map((radio) => radio.props.accessibilityLabel)).toEqual(
      APP_THEME_IDS.map(nameOf),
    );
    for (const id of APP_THEME_IDS) {
      expect(themes.getByText(t(`theme.${id}.description`))).toBeOnTheScreen();
    }
    expect(themes.getAllByTestId('theme-preview', hidden)).toHaveLength(APP_THEME_IDS.length);
    await waitFor(() => expect(themes.getByRole('radio', { name: 'Журнал' })).toBeChecked());
    expect(themes.getByRole('radio', { name: 'Классика' })).not.toBeChecked();
  });
});

describe('выбор темы (AC2)', () => {
  it('нажатие — PUT /v1/profile/theme, отметка и тема корня меняются сразу', async () => {
    setProfileTheme.mockReturnValue(never());
    await open();
    const themes = await list();
    await waitFor(() => expect(themes.getByRole('radio', { name: 'Классика' })).toBeChecked());

    await fireEvent.press(themes.getByRole('radio', { name: 'Атлас' }));
    expect(setProfileTheme).toHaveBeenCalledWith(liveSession.accessToken, { themeId: 'atlas' });
    await waitFor(() => expect(themes.getByRole('radio', { name: 'Атлас' })).toBeChecked());
    await waitFor(() =>
      expect(screen.getByTestId('theme-screen-root')).toHaveStyle({
        backgroundColor: surfaceOf('atlas'),
      }),
    );
  });

  it.each([
    [
      'сбой API',
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
      t('settings.theme.saveFailed'),
    ],
    [
      'лимит',
      new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 60 } }),
      t('settings.theme.saveFailed'),
    ],
    [
      'нет сети',
      new ApiNetworkError(new TypeError('Network request failed')),
      t('auth.error.network'),
    ],
  ])('ошибка сохранения (%s) — баннер, отметка и тема возвращаются', async (_, error, text) => {
    setProfileTheme.mockRejectedValue(error);
    await open();
    const themes = await list();
    await waitFor(() => expect(themes.getByRole('radio', { name: 'Классика' })).toBeChecked());

    await fireEvent.press(themes.getByRole('radio', { name: 'Хронометр' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(themes.getByRole('radio', { name: 'Классика' })).toBeChecked();
    expect(themes.getByRole('radio', { name: 'Хронометр' })).not.toBeChecked();
    expect(screen.getByTestId('theme-screen-root')).toHaveStyle({
      backgroundColor: surfaceOf('classic'),
    });
  });
});

describe('состояния данных (инвариант 12)', () => {
  it('первая загрузка профиля — скелетон списка, заголовок сразу', async () => {
    getProfile.mockImplementation(never);
    await open();
    expect(await screen.findByRole('header', { name: 'Тема' })).toBeOnTheScreen();
    expect(screen.getByTestId('theme-skeleton', hidden)).toBeOnTheScreen();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('ошибка профиля (%s) — экран ошибки с повтором', async (_, error, title) => {
    getProfile.mockRejectedValue(error);
    await openScreen();
    expect(await screen.findByText(title)).toBeOnTheScreen();
    getProfile.mockResolvedValue(profile('atlas'));
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    const themes = await list();
    await waitFor(() => expect(themes.getByRole('radio', { name: 'Атлас' })).toBeChecked());
  });
});

describe('гость (AC3)', () => {
  it('/settings/theme → лендинг (гард вкладок, как «Язык»)', async () => {
    resetSessionStore();
    jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store.clear();
    const router = await open();
    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
  });
});
