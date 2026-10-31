/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { ProfileView } from '@pokatim/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

import { useSessionStore } from '@/features/auth/session-store';
import { imagePickerSupported } from '@/features/profile/image-picker-support';
import { loadImagePicker } from '@/features/profile/load-image-picker';
import { api } from '@/lib/api';

import { liveSession, signInForTest } from './auth-fixtures';
import ProfileScreen from '../app/settings/profile';

jest.mock('@/lib/api');

const getProfile = jest.mocked(api.getProfile);
const updateProfile = jest.mocked(api.updateProfile);

const NAME = 'Как вас показывать в результатах';
const CLUB = 'Клуб';
const AVATAR_ID = 'r'.repeat(43);
const SHOW = 'Показывать имя в таблицах результатов';
const SHOW_RIDES = 'Показывать мои заезды в таблицах маршрутов';
const RIDES_HINT =
  'Другие райдеры увидят ваше время и день заезда на маршрутах каталога. Имя и фото — только если включён показ имени.';
const never = () => new Promise<never>(() => undefined);
const profile = (overrides: Partial<ProfileView> = {}): ProfileView => ({
  rideReasons: [],
  publicName: null,
  showNameInResults: false,
  club: null,
  avatar: null,
  publicId: null,
  themeId: 'classic',
  avatarUploadBlockedUntil: null,
  showRouteRides: false,
  ...overrides,
});
const RESULTS_KEY = ['races', 'results', 'race-1', 'page'];
const RIDER_KEY = ['riders', 'detail', 'x'];
const ROUTE_ID = '0190a6f4-0000-7000-8000-000000000001';
const LEADERBOARD_KEY = ['route-rides', ROUTE_ID, 'leaderboard', 5];
const RIDES_LIST_KEY = ['route-rides', ROUTE_ID, 'list'];

let client: QueryClient;

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  getProfile.mockResolvedValue(profile());
  // блок «Сезон» (08c) — сезонов нет, блок скрыт; сам блок — `profile-season-block.test.tsx`
  jest.mocked(api.getCurrentSeason).mockResolvedValue({ season: null });
  jest.mocked(api.listSeasons).mockResolvedValue({ items: [] });
  jest.mocked(api.avatarUrl).mockImplementation((id) => `https://api.test/v1/avatars/${id}`);
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
    { 'settings/profile': ProfileScreen, 'settings/account/delete': () => null },
    { initialUrl: '/settings/profile', wrapper },
  );
}

const save = () => screen.getByRole('button', { name: 'Сохранить' });

describe('«Редактировать профиль»: загрузка (AC9, rider-profile AC14)', () => {
  it('заголовок сразу, на месте полей — скелетон', async () => {
    getProfile.mockReturnValue(never());
    await openProfile();
    expect(await screen.findByRole('header', { name: 'Редактировать профиль' })).toBeOnTheScreen();
    // первый скелетон — поля профиля (ниже, пока определяется сезон, — скелетон блока «Сезон», 08c)
    expect(screen.getAllByLabelText('Загрузка')[0]).toBeOnTheScreen();
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
        'Имя увидят все в таблицах результатов гонок. Выключите — вместо имени будет номер, например «Райдер #12».',
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

describe('«Профиль»: удаление аккаунта (account-deletion AC8)', () => {
  it('внизу — «Удалить аккаунт» → экран удаления; видна и пока профиль грузится', async () => {
    getProfile.mockReturnValue(never());
    const router = await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить аккаунт' }));
    await waitFor(() => expect(router.getPathname()).toBe('/settings/account/delete'));
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
    client.setQueryData(RIDER_KEY, { name: 'x' });
    await openProfile();

    await fireEvent.changeText(await screen.findByLabelText(NAME), '  Анна К. ');
    await fireEvent.press(screen.getByRole('switch', { name: SHOW }));
    await fireEvent.press(save());

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(liveSession.accessToken, {
        publicName: 'Анна К.',
        club: null,
        showNameInResults: true,
        showRouteRides: false,
      }),
    );
    expect(save()).toBeDisabled();
    resolve(saved);

    expect(await screen.findByText('Сохранено')).toBeOnTheScreen();
    expect(save()).not.toBeDisabled();
    expect(client.getQueryData(['profile'])).toEqual(saved);
    expect(client.getQueryState(RESULTS_KEY)?.isInvalidated).toBe(true);
    // публичный профиль (rider-profile): имя и клуб — инвалидация `['riders']`
    expect(client.getQueryState(RIDER_KEY)?.isInvalidated).toBe(true);
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
        club: null,
        showNameInResults: true,
        showRouteRides: false,
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

describe('«Редактировать профиль»: показ заездов в таблицах маршрутов (route-rides-04)', () => {
  it('переключатель под «Показывать имя…» с пояснением; начальное значение — из профиля', async () => {
    getProfile.mockResolvedValue(profile({ showRouteRides: true }));
    await openProfile();
    const rides = await screen.findByRole('switch', { name: SHOW_RIDES });
    expect(rides).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
    expect(screen.getByText(RIDES_HINT)).toBeOnTheScreen();
    const switches = screen.getAllByRole('switch').map((node) => node.props.accessibilityLabel);
    expect(switches.indexOf(SHOW_RIDES)).toBe(switches.indexOf(SHOW) + 1);
  });

  it('«Сохранить» шлёт showRouteRides; таблицы «Другие» устарели, «Мои заезды» — нет', async () => {
    updateProfile.mockResolvedValue(profile({ showRouteRides: true }));
    client.setQueryData(LEADERBOARD_KEY, null);
    client.setQueryData(RIDES_LIST_KEY, null);
    await openProfile();
    await fireEvent.press(await screen.findByRole('switch', { name: SHOW_RIDES }));
    await fireEvent.press(save());
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(liveSession.accessToken, {
        publicName: null,
        club: null,
        showNameInResults: false,
        showRouteRides: true,
      }),
    );
    expect(await screen.findByText('Сохранено')).toBeOnTheScreen();
    expect(client.getQueryState(LEADERBOARD_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(RIDES_LIST_KEY)?.isInvalidated).toBe(false);
  });

  it('после сохранения — значение из ответа сервера', async () => {
    updateProfile.mockResolvedValue(profile({ showRouteRides: false }));
    await openProfile();
    await fireEvent.press(await screen.findByRole('switch', { name: SHOW_RIDES }));
    await fireEvent.press(save());
    expect(await screen.findByText('Сохранено')).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: SHOW_RIDES })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: false }),
    );
  });

  it('серверная ошибка поля showRouteRides — текст под переключателем', async () => {
    updateProfile.mockRejectedValue(
      new ApiHttpError(400, {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { fields: [{ path: 'showRouteRides', code: 'INVALID' }] },
      }),
    );
    await openProfile();
    await fireEvent.press(await screen.findByRole('switch', { name: SHOW_RIDES }));
    await fireEvent.press(save());
    expect(await screen.findByText('Проверьте значение.')).toBeOnTheScreen();
    expect(screen.queryByText('Сохранено')).toBeNull();
  });
});

describe('«Редактировать профиль»: клуб (rider-profile, AC14)', () => {
  it('клуб в поле; сохранение — в теле PATCH; пустой — null', async () => {
    getProfile.mockResolvedValue(profile({ club: 'Velo Club Minsk' }));
    updateProfile.mockResolvedValue(profile({ club: 'Минск Вело' }));
    await openProfile();
    expect(await screen.findByDisplayValue('Velo Club Minsk')).toBeOnTheScreen();
    expect(screen.getByLabelText(CLUB)).toHaveProp(
      'accessibilityHint',
      'Например, Velo Club Minsk. Виден в публичном профиле вместе с именем',
    );

    await fireEvent.changeText(screen.getByLabelText(CLUB), ' Минск Вело ');
    await fireEvent.press(save());
    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith(liveSession.accessToken, {
        publicName: null,
        club: 'Минск Вело',
        showNameInResults: false,
        showRouteRides: false,
      }),
    );
  });

  it('одна буква — «Не короче 2 символов.» без запроса; ошибка сервера — под полем клуба', async () => {
    await openProfile();
    await fireEvent.changeText(await screen.findByLabelText(CLUB), 'В');
    await fireEvent.press(save());
    expect(await screen.findByText('Не короче 2 символов.')).toBeOnTheScreen();
    expect(updateProfile).not.toHaveBeenCalled();

    updateProfile.mockRejectedValue(
      new ApiHttpError(400, {
        code: 'VALIDATION_FAILED',
        message: 'x',
        details: { fields: [{ path: 'club', code: 'TOO_LONG' }] },
      }),
    );
    await fireEvent.changeText(screen.getByLabelText(CLUB), 'Велоклуб');
    await fireEvent.press(save());
    expect(await screen.findByText('Слишком длинное значение.')).toBeOnTheScreen();
  });
});

describe('«Редактировать профиль»: фото на iOS и Android (rider-profile, AC14)', () => {
  const launch = jest.fn();
  const body = new Blob(['jpeg']);
  const pickButton = () => screen.getByRole('button', { name: 'Выбрать фото' });

  beforeEach(() => {
    jest.mocked(loadImagePicker).mockResolvedValue({ launchImageLibraryAsync: launch } as never);
    launch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/me.jpg', fileSize: 1000, width: 512, height: 512 }],
    });
    global.fetch = jest.fn(async () => ({ blob: async () => body })) as unknown as typeof fetch;
  });

  it('нет фото — пустой квадрат и подсказка; «Удалить фото» нет', async () => {
    await openProfile();
    expect(await screen.findByRole('image', { name: 'Фото не выбрано' })).toBeOnTheScreen();
    expect(screen.getByText('Мы уберём из фото геометки и данные камеры')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Удалить фото' })).toBeNull();
  });

  it('выбор → загрузка без crop; кнопка занята; ответ — в кэш профиля, публичный профиль устаревает', async () => {
    let resolve: (view: ProfileView) => void = () => undefined;
    jest.mocked(api.uploadAvatar).mockReturnValue(
      new Promise<ProfileView>((done) => {
        resolve = done;
      }),
    );
    client.setQueryData(RIDER_KEY, { name: 'x' });
    await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Выбрать фото' }));

    await waitFor(() =>
      expect(api.uploadAvatar).toHaveBeenCalledWith(liveSession.accessToken, body, undefined),
    );
    expect(pickButton()).toBeDisabled();
    resolve(profile({ avatar: { id: AVATAR_ID } }));

    expect(await screen.findByRole('image', { name: 'Фото профиля' })).toBeOnTheScreen();
    expect(client.getQueryData<ProfileView>(['profile'])?.avatar).toEqual({ id: AVATAR_ID });
    expect(client.getQueryState(RIDER_KEY)?.isInvalidated).toBe(true);
    expect(pickButton()).not.toBeDisabled();
  });

  it('отмена выбора — без запроса', async () => {
    launch.mockResolvedValue({ canceled: true, assets: null });
    await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Выбрать фото' }));
    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(api.uploadAvatar).not.toHaveBeenCalled();
  });

  it('старый dev-клиент без модуля — «Чтобы выбрать фото, обновите приложение»', async () => {
    jest.mocked(imagePickerSupported).mockReturnValueOnce(false);
    await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Выбрать фото' }));
    expect(await screen.findByText('Чтобы выбрать фото, обновите приложение')).toBeOnTheScreen();
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    [415, 'AVATAR_FORMAT_UNSUPPORTED', undefined, 'Выберите фото в формате JPEG, PNG или WebP'],
    [413, 'AVATAR_TOO_LARGE', undefined, 'Фото больше 10 МБ — выберите фото поменьше'],
    [422, 'AVATAR_INVALID', undefined, 'Не удалось обработать фото — выберите другое'],
    [
      429,
      'RATE_LIMITED',
      { retryAfterSec: 1800 },
      'Слишком много загрузок фото. Повторите через 30:00',
    ],
    [
      429,
      'RATE_LIMITED',
      { retryAfterSec: 5 },
      'Фото сейчас обрабатываются. Попробуйте ещё раз через минуту',
    ],
  ])('отказ %s %s — понятный текст', async (status, code, details, text) => {
    jest
      .mocked(api.uploadAvatar)
      .mockRejectedValue(new ApiHttpError(status, { code, message: 'x', details }));
    await openProfile();
    await fireEvent.press(await screen.findByRole('button', { name: 'Выбрать фото' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it('запрет загрузки — «Выбрать фото» неактивна, подпись с датой; «Удалить фото» доступна', async () => {
    getProfile.mockResolvedValue(
      profile({ avatar: { id: AVATAR_ID }, avatarUploadBlockedUntil: '2026-11-29T11:05:00.000Z' }),
    );
    await openProfile();
    expect(
      await screen.findByText(
        'Загрузка фото недоступна до 29 ноября 2026, 14:05 после нарушений правил',
      ),
    ).toBeOnTheScreen();
    expect(pickButton()).toBeDisabled();
    await fireEvent.press(pickButton());
    expect(launch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Удалить фото' })).not.toBeDisabled();
  });

  it('409 avatar_blocked на загрузке (гонка со сбросом) — тот же текст баннером, профиль перечитан', async () => {
    jest.mocked(api.uploadAvatar).mockRejectedValue(
      new ApiHttpError(409, {
        code: 'PROFILE_INVALID_STATE',
        message: 'x',
        details: { reason: 'avatar_blocked', until: '2026-11-29T11:05:00.000Z' },
      }),
    );
    await openProfile();
    getProfile.mockResolvedValue(profile({ avatarUploadBlockedUntil: '2026-11-29T11:05:00.000Z' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Выбрать фото' }));
    expect(
      (
        await screen.findAllByText(
          'Загрузка фото недоступна до 29 ноября 2026, 14:05 после нарушений правил',
        )
      ).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(getProfile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pickButton()).toBeDisabled());
  });

  it('удаление — с подтверждением: «Оставить» без запроса, «Удалить» — запрос и пустой квадрат', async () => {
    getProfile.mockResolvedValue(profile({ avatar: { id: AVATAR_ID } }));
    jest.mocked(api.deleteAvatar).mockResolvedValue(profile());
    await openProfile();

    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить фото' }));
    expect(screen.getByText('Удалить фото?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Оставить' }));
    expect(api.deleteAvatar).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Удалить фото' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.deleteAvatar).toHaveBeenCalledWith(liveSession.accessToken));
    expect(await screen.findByRole('image', { name: 'Фото не выбрано' })).toBeOnTheScreen();
    expect(screen.queryByText('Удалить фото?')).toBeNull();
  });
});
