/// <reference types="jest" />
import { i18n } from '@pokatim/i18n';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { openExternalUrl } from '@/lib/open-external-url';
import { resetSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { appRoutes } from './app-routes';
import { signInForTest, storeSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import LanguageScreen from '../app/settings/language';
import SettingsScreen from '../app/settings/index';

jest.mock('@/lib/api');
jest.mock('@/lib/open-external-url', () => ({ openExternalUrl: jest.fn() }));
// версия сборки — из `app.json` (`expo.version`); в jest конфигурации Expo нет
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

const openUrl = jest.mocked(openExternalUrl);
const LINK_ENV = ['EXPO_PUBLIC_PRIVACY_URL', 'EXPO_PUBLIC_TERMS_URL', 'EXPO_PUBLIC_SUPPORT_EMAIL'];
const stub = () => null;

beforeEach(() => {
  signInForTest();
  openUrl.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const name of LINK_ENV) delete process.env[name];
  jest.clearAllMocks();
});

async function openSettings() {
  return renderRouter(
    {
      'settings/index': SettingsScreen,
      'settings/language': LanguageScreen,
      profile: stub,
      'settings/verified': stub,
      'settings/devices': stub,
      'settings/notifications': stub,
      'settings/account/delete': stub,
    },
    { initialUrl: '/settings', wrapper: createQueryWrapper() },
  );
}

const links = () =>
  screen.getAllByRole('link').map((link) => link.props.accessibilityLabel as string);

describe('«Настройки»: разделы (AC2)', () => {
  it('заголовок, разделы аккаунта, язык, версия; пункта «Тема» нет', async () => {
    await openSettings();
    expect(await screen.findByRole('header', { name: 'Настройки' })).toBeOnTheScreen();
    for (const kicker of ['Аккаунт', 'Приложение', 'О приложении']) {
      expect(screen.getByRole('header', { name: kicker })).toBeOnTheScreen();
    }
    expect(links()).toEqual([
      'Профиль',
      'Анкета Verified',
      'Устройства',
      'Уведомления',
      'Язык, Русский',
    ]);
    expect(screen.getByLabelText('Версия, 1.0.0')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Удалить аккаунт' })).toBeOnTheScreen();
    expect(screen.queryByText(/Тема/)).toBeNull();
  });

  it.each([
    // rider-profile (D-B3): «Профиль» — свой профиль; «Редактировать профиль» — оттуда
    ['Профиль', '/profile'],
    ['Анкета Verified', '/settings/verified'],
    ['Устройства', '/settings/devices'],
    ['Уведомления', '/settings/notifications'],
    ['Язык, Русский', '/settings/language'],
  ])('«%s» ведёт на %s', async (label, path) => {
    const router = await openSettings();
    await fireEvent.press(await screen.findByRole('link', { name: label }));
    expect(router.getPathname()).toBe(path);
  });

  it('«Удалить аккаунт» — экран удаления', async () => {
    const router = await openSettings();
    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить аккаунт' }));
    expect(router.getPathname()).toBe('/settings/account/delete');
  });
});

describe('«Настройки»: о приложении (AC3)', () => {
  it('ссылки не заданы в сборке — строк политики, условий и поддержки нет', async () => {
    await openSettings();
    await screen.findByRole('header', { name: 'Настройки' });
    expect(screen.queryByText('Политика конфиденциальности')).toBeNull();
    expect(screen.queryByText('Условия использования')).toBeNull();
    expect(screen.queryByText('Поддержка')).toBeNull();
  });

  it('заданы — открываются по нажатию; поддержка — письмом', async () => {
    process.env.EXPO_PUBLIC_PRIVACY_URL = 'https://pokatim.by/privacy';
    process.env.EXPO_PUBLIC_TERMS_URL = 'https://pokatim.by/terms';
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help@pokatim.by';
    await openSettings();

    await fireEvent.press(await screen.findByRole('link', { name: 'Политика конфиденциальности' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Условия использования' }));
    await fireEvent.press(screen.getByRole('link', { name: 'Поддержка, help@pokatim.by' }));
    expect(openUrl.mock.calls).toEqual([
      ['https://pokatim.by/privacy'],
      ['https://pokatim.by/terms'],
      ['mailto:help@pokatim.by'],
    ]);
  });

  it('ссылка не открылась — баннер', async () => {
    process.env.EXPO_PUBLIC_TERMS_URL = 'https://pokatim.by/terms';
    openUrl.mockRejectedValueOnce(new Error('no browser'));
    await openSettings();
    await fireEvent.press(await screen.findByRole('link', { name: 'Условия использования' }));
    expect(
      await screen.findByText('Не удалось открыть ссылку. Попробуйте ещё раз.'),
    ).toBeOnTheScreen();
  });
});

describe('«Настройки»: выход (AC4)', () => {
  it('пока идёт выход, «Выйти» недоступна', async () => {
    jest.mocked(api.signOut).mockReturnValue(new Promise<never>(() => undefined));
    await openSettings();
    await fireEvent.press(await screen.findByRole('button', { name: 'Выйти' }));
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeDisabled();
  });
});

describe('«Язык» (AC5)', () => {
  it('список языков интерфейса, текущий выбран; выбор сохраняется на устройстве', async () => {
    const setLocale = jest.spyOn(i18n, 'setLocale');
    const router = await openSettings();
    await fireEvent.press(await screen.findByRole('link', { name: 'Язык, Русский' }));

    expect(await screen.findByRole('header', { name: 'Язык' })).toBeOnTheScreen();
    const list = within(screen.getByTestId('language-list'));
    const russian = list.getByRole('radio', { name: 'Русский' });
    expect(russian).toBeChecked();
    expect(list.getAllByRole('radio')).toHaveLength(i18n.locales.length);

    await fireEvent.press(russian);
    expect(setLocale).toHaveBeenCalledWith('ru');
    const store = jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store').__store;
    expect(store.get('pokatim.locale')).toBe('"ru"');
    expect(router.getPathname()).toBe('/settings/language');
    setLocale.mockRestore();
  });
});

describe('язык при запуске (AC5)', () => {
  it('корневой layout применяет сохранённый язык устройства', async () => {
    const setLocale = jest.spyOn(i18n, 'setLocale');
    storeSession();
    jest
      .requireMock<{ __store: Map<string, string> }>('expo-secure-store')
      .__store.set('pokatim.locale', '"ru"');
    await renderRouter(appRoutes, { initialUrl: '/settings' });
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('ru'));
    setLocale.mockRestore();
  });
});

describe('гость (AC6)', () => {
  it.each(['/settings', '/settings/language'])('%s → «Регистрация» (гард вкладок)', async (url) => {
    resetSessionStore();
    const router = await renderRouter(appRoutes, { initialUrl: url });
    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
  });
});
