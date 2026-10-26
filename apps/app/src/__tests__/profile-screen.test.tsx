/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { ProfileView } from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import { liveSession, signInForTest } from './auth-fixtures';
import ProfileScreen from '../app/settings/profile';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);
const updateProfile = jest.mocked(api.updateProfile);

const NAME = 'Как вас показывать в результатах';
const SHOW = 'Показывать имя в таблицах результатов';
const never = () => new Promise<never>(() => undefined);
const profile = (overrides: Partial<ProfileView> = {}): ProfileView => ({
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  ...overrides,
});
const RESULTS_KEY = ['races', 'results', 'race-1', 'page'];

let client: QueryClient;

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  getProfile.mockResolvedValue(profile());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  jest.clearAllMocks();
});

async function openProfile() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderRouter(
    { 'settings/profile': ProfileScreen },
    { initialUrl: '/settings/profile', wrapper },
  );
}

const save = () => screen.getByRole('button', { name: 'Сохранить' });

describe('«Профиль»: загрузка (AC9)', () => {
  it('заголовок сразу, на месте полей — скелетон', async () => {
    getProfile.mockReturnValue(never());
    await openProfile();
    expect(await screen.findByRole('header', { name: 'Профиль' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.queryByLabelText(NAME)).toBeNull();
    expect(getProfile).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it('данные — имя в поле, переключатель, пояснение', async () => {
    getProfile.mockResolvedValue(profile({ publicName: 'Анна К.', showNameInResults: true }));
    await openProfile();
    expect(await screen.findByDisplayValue('Анна К.')).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: SHOW })).toBeChecked();
    expect(screen.getByLabelText(NAME)).toHaveProp('accessibilityHint', 'Например, Анна К.');
    expect(
      screen.getByText(
        'Имя увидят все в таблицах результатов гонок. Выключите — вы будете «Участник»',
      ),
    ).toBeOnTheScreen();
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('ошибка загрузки (%s) — «%s» с повтором', async (_case, error, title) => {
    getProfile.mockRejectedValueOnce(error);
    await openProfile();
    expect(await screen.findByText(title)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByLabelText(NAME)).toBeOnTheScreen();
  });
});

describe('«Профиль»: сохранение (AC9)', () => {
  it('имя и переключатель — тело PATCH; кнопка занята на время запроса; успех — сообщение; кэш обновлён', async () => {
    const saved = profile({ publicName: 'Анна К.', showNameInResults: true });
    let resolve: (view: ProfileView) => void = () => undefined;
    updateProfile.mockReturnValue(
      new Promise<ProfileView>((done) => {
        resolve = done;
      }),
    );
    client.setQueryData(RESULTS_KEY, { items: [] });
    await openProfile();

    await fireEvent.changeText(await screen.findByLabelText(NAME), '  Анна К. ');
    await fireEvent.press(screen.getByRole('switch', { name: SHOW }));
    await fireEvent.press(save());

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(liveSession.accessToken, {
        publicName: 'Анна К.',
        showNameInResults: true,
      }),
    );
    expect(save()).toBeDisabled();
    resolve(saved);

    expect(await screen.findByText('Сохранено')).toBeOnTheScreen();
    expect(save()).not.toBeDisabled();
    expect(client.getQueryData(['profile'])).toEqual(saved);
    expect(client.getQueryState(RESULTS_KEY)?.isInvalidated).toBe(true);
  });

  it('пустое имя при включённом переключателе — допустимо (null)', async () => {
    updateProfile.mockResolvedValue(profile({ showNameInResults: true }));
    await openProfile();
    await screen.findByLabelText(NAME);
    await fireEvent.press(screen.getByRole('switch', { name: SHOW }));
    await fireEvent.press(save());
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(liveSession.accessToken, {
        publicName: null,
        showNameInResults: true,
      }),
    );
  });

  it.each([
    ['одна буква', 'А', 'Не короче 2 символов.'],
    ['служебная подпись', 'Участник', 'Проверьте значение.'],
  ])('клиентская проверка (%s) — ошибка под полем без запроса', async (_case, value, text) => {
    await openProfile();
    await fireEvent.changeText(await screen.findByLabelText(NAME), value);
    await fireEvent.press(save());
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('серверная ошибка поля (400) — текст по коду под полем', async () => {
    updateProfile.mockRejectedValue(
      new ApiHttpError(400, {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { fields: [{ path: 'publicName', code: 'TOO_LONG' }] },
      }),
    );
    await openProfile();
    await fireEvent.changeText(await screen.findByLabelText(NAME), 'Анна К.');
    await fireEvent.press(save());
    expect(await screen.findByText('Слишком длинное значение.')).toBeOnTheScreen();
    expect(screen.queryByText('Сохранено')).toBeNull();
  });

  it('сбой сети при сохранении — баннер, введённое остаётся', async () => {
    updateProfile.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await openProfile();
    await fireEvent.changeText(await screen.findByLabelText(NAME), 'Анна К.');
    await fireEvent.press(save());
    expect(
      await screen.findByText('Нет соединения. Проверьте подключение к интернету и повторите.'),
    ).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Анна К.')).toBeOnTheScreen();
  });
});
