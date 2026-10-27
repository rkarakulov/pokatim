/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { OnboardingStatus } from '@pokatim/contracts';
import { focusManager, onlineManager } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { openAuthSessionAsync } from 'expo-web-browser';

import { api } from '@/lib/api';

import { liveSession, storedValue, storeSession, storeSurveyCompleted } from './auth-fixtures';
import { appRoutes } from './app-routes';
import { deviceList, garmin, TICKET, uploadPage, wahoo } from './devices-fixtures';
import { USER_A } from './jwt';

jest.mock('@/lib/api');
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const status = jest.mocked(api.getOnboardingStatus);
const listDevices = jest.mocked(api.listDevices);
const completeStep = jest.mocked(api.completeDevicesStep);
const authSession = jest.mocked(openAuthSessionAsync);

const stepTitle = () => screen.findByRole('header', { name: 'Подключите устройство' });
const home = () => screen.findByRole('header', { name: 'Покатим' });
const cache = () => JSON.parse(storedValue('pokatim.onboarding') ?? '{}') as unknown;

beforeEach(() => {
  // геопозиция уже решена ОС — шаг геопозиции пропускается (тест порядка шагов задаёт своё)
  jest
    .mocked(Location.getForegroundPermissionsAsync)
    .mockResolvedValue({ status: 'granted' } as Location.LocationPermissionResponse);
  jest.mocked(api.signOut).mockResolvedValue(undefined);
  jest.mocked(api.refreshSession).mockReset();
  listDevices.mockResolvedValue(deviceList(garmin(), wahoo()));
  completeStep.mockResolvedValue({ surveyCompleted: true, devicesStepCompleted: true });
  // Главная после шага
  jest
    .mocked(api.getProfile)
    .mockResolvedValue({ rideReasons: [], publicName: null, showNameInResults: false });
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCalendar).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listTrackUploads).mockResolvedValue(uploadPage());
});
afterEach(() => jest.clearAllMocks());

/** Вошедший пользователь (живой access); статус онбординга — ответ сервера. */
async function openSignedIn(answer: OnboardingStatus, path = '/') {
  storeSession(liveSession);
  status.mockResolvedValue(answer);
  return renderRouter(appRoutes, { initialUrl: path });
}

describe('гард онбординга: шаг устройств (AC11)', () => {
  it('опрос → геопозиция → «Подключите устройство» → «Позже» → Главная; флаг — на сервере и в кеше владельца', async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValue({ status: 'undetermined' } as Location.LocationPermissionResponse);
    jest
      .mocked(api.submitOnboardingSurvey)
      .mockResolvedValue({ surveyCompleted: true, devicesStepCompleted: false });
    const router = await openSignedIn({ surveyCompleted: false, devicesStepCompleted: false });

    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Новые маршруты' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Продолжить' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Не сейчас' }));

    expect(await stepTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/devices');
    expect(screen.getByText('Знакомство')).toBeOnTheScreen();
    expect(screen.queryByRole('tab', { name: 'Главная' })).toBeNull();

    await fireEvent.press(await screen.findByRole('button', { name: 'Позже' }));

    expect(await home()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(completeStep).toHaveBeenCalledWith(liveSession.accessToken, { outcome: 'later' });
    expect(cache()).toEqual({ surveyCompleted: true, userId: USER_A, devicesStepCompleted: true });
  });

  it('шаг уже пройден на сервере (другое устройство) — Главная без шага', async () => {
    const router = await openSignedIn({ surveyCompleted: true, devicesStepCompleted: true });
    expect(await home()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    expect(listDevices).not.toHaveBeenCalled();
  });

  it('старый API без поля — шаг пропущен', async () => {
    const router = await openSignedIn({ surveyCompleted: true });
    expect(await home()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  it('кеш опроса без шага устройств — сервер спрашивается: шаг не пройден → шаг', async () => {
    storeSurveyCompleted(USER_A, { devicesStepCompleted: false });
    const router = await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    expect(await stepTitle()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/devices');
  });

  it('кеш опроса без шага устройств, статус не получен (офлайн) — Главная без ожидания сети', async () => {
    storeSession(liveSession);
    storeSurveyCompleted(USER_A, { devicesStepCompleted: false });
    status.mockRejectedValue(new ApiNetworkError(new TypeError('Network request failed')));
    await renderRouter(appRoutes, { initialUrl: '/' });

    expect(await home()).toBeOnTheScreen();
  });

  it('/devices с пройденным шагом → Главная', async () => {
    storeSurveyCompleted();
    const router = await openSignedIn(
      { surveyCompleted: true, devicesStepCompleted: true },
      '/devices',
    );
    expect(await home()).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  it('выход стирает кеш «шаг пройден»', async () => {
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });
    await fireEvent.press(await screen.findByRole('button', { name: 'Позже' }));
    await home();
    expect(cache()).toMatchObject({ devicesStepCompleted: true });

    await fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));
    expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
    expect(storedValue('pokatim.onboarding')).toBeUndefined();
  });
});

describe('экран «Подключите устройство» (AC11)', () => {
  it('кнопки доступных провайдеров и «Позже»; недоступный провайдер — без кнопки', async () => {
    listDevices.mockResolvedValue(deviceList(garmin(), wahoo({ available: false })));
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    expect(await screen.findByRole('button', { name: 'Подключить Garmin' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Подключить Wahoo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Позже' })).toBeOnTheScreen();
  });

  it.each([
    [
      'все `available: false`',
      () =>
        listDevices.mockResolvedValue(
          deviceList(garmin({ available: false }), wahoo({ available: false })),
        ),
    ],
    [
      'сервер без агрегатора (404)',
      () =>
        listDevices.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' })),
    ],
  ])('%s — только «Позже» и подсказка про загрузку файлом', async (_case, arrange) => {
    arrange();
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    expect(
      await screen.findByText('Загрузить заезды файлом можно в разделе «Устройства».'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Подключить/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Позже' })).toBeOnTheScreen();
  });

  it('`GET /v1/devices` отказал (500) — «Не удалось загрузить» с повтором, «Позже» доступна', async () => {
    listDevices.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    expect(
      await screen.findByText('Не удалось загрузить', {}, { timeout: 6000 }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Загрузить заезды файлом можно в разделе «Устройства».')).toBeNull();
    expect(screen.getByRole('button', { name: 'Позже' })).toBeEnabled();

    listDevices.mockResolvedValue(deviceList(garmin(), wahoo()));
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Подключить Garmin' })).toBeOnTheScreen();
  }, 15000);

  it('офлайн → сеть вернулась, запрос отказал (500) — «Не удалось загрузить» с повтором, «Позже» доступна', async () => {
    onlineManager.setOnline(false);
    try {
      listDevices.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
      await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });
      expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();

      await act(async () => {
        onlineManager.setOnline(true);
      });
      expect(
        await screen.findByText('Не удалось загрузить', {}, { timeout: 6000 }),
      ).toBeOnTheScreen();
      expect(listDevices).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Позже' })).toBeEnabled();
    } finally {
      onlineManager.setOnline(true);
    }
  }, 15000);

  it('ошибка обновления при показанных провайдерах — провайдеры остаются, баннер с повтором', async () => {
    jest
      .mocked(api.connectDevice)
      .mockResolvedValue({ authorizeUrl: 'https://ow.example/authorize' });
    authSession.mockResolvedValue({ type: 'cancel' } as Awaited<
      ReturnType<typeof openAuthSessionAsync>
    >);
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });
    await screen.findByRole('button', { name: 'Подключить Garmin' });

    // браузер закрыли — список перезапрашивается и падает
    listDevices.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Подключить Garmin' }));

    expect(await screen.findByText('Повторить', {}, { timeout: 6000 })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Подключить Garmin' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Подключить Wahoo' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Позже' })).toBeEnabled();
  }, 15000);

  it('ошибка обновления при подключённом Garmin — «Garmin подключён» остаётся, баннер с повтором; повтор восстанавливает', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'active' }), wahoo()));
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });
    expect(await screen.findByText('Garmin подключён')).toBeOnTheScreen();

    // возврат в фокус — фоновое обновление списка падает
    listDevices.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    try {
      await act(async () => {
        focusManager.setFocused(false);
      });
      await act(async () => {
        focusManager.setFocused(true);
      });

      expect(
        await screen.findByRole('button', { name: 'Повторить' }, { timeout: 6000 }),
      ).toBeOnTheScreen();
      expect(screen.getByText('Garmin подключён')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Продолжить' })).toBeOnTheScreen();

      listDevices.mockResolvedValue(deviceList(garmin({ status: 'active' }), wahoo()));
      await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull());
      expect(screen.getByText('Garmin подключён')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Продолжить' })).toBeOnTheScreen();
    } finally {
      focusManager.setFocused(undefined);
    }
  }, 15000);

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), /Нет соединения/],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), /Не удалось сохранить/],
  ])('ошибка сохранения (%s) — баннер, повтор той же кнопкой', async (_case, error, text) => {
    completeStep.mockRejectedValueOnce(error);
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    await fireEvent.press(await screen.findByRole('button', { name: 'Позже' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(await stepTitle()).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Позже' }));
    expect(await home()).toBeOnTheScreen();
  });

  it('офлайн: «Нет соединения» с повтором, «Позже» доступна — без сети баннер, повтор той же кнопкой', async () => {
    onlineManager.setOnline(false);
    try {
      completeStep.mockRejectedValueOnce(
        new ApiNetworkError(new TypeError('Network request failed')),
      );
      await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

      expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
      expect(listDevices).not.toHaveBeenCalled();
      const later = screen.getByRole('button', { name: 'Позже' });
      expect(later).toBeEnabled();

      // мутация шага — `networkMode: 'always'`: запрос уходит и без сети, ошибка — баннер
      await fireEvent.press(later);
      expect(await screen.findByText(/Нет соединения\. Проверьте/)).toBeOnTheScreen();
      expect(completeStep).toHaveBeenCalledWith(liveSession.accessToken, { outcome: 'later' });
      expect(await stepTitle()).toBeOnTheScreen();

      await fireEvent.press(screen.getByRole('button', { name: 'Позже' }));
      expect(await home()).toBeOnTheScreen();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('`pending` (браузер закрыли / OW увёл на свою ошибку) — «Подключить снова» начинает заново', async () => {
    listDevices.mockResolvedValue(deviceList(garmin({ status: 'pending' }), wahoo()));
    jest
      .mocked(api.connectDevice)
      .mockResolvedValue({ authorizeUrl: 'https://ow.example/authorize' });
    authSession.mockResolvedValue({ type: 'cancel' } as Awaited<
      ReturnType<typeof openAuthSessionAsync>
    >);
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    await fireEvent.press(await screen.findByRole('button', { name: 'Подключить Garmin снова' }));
    await waitFor(() => expect(authSession).toHaveBeenCalled());
    expect(jest.mocked(api.connectDevice).mock.calls[0]?.[1]).toBe('garmin');
    expect(screen.getByRole('button', { name: 'Подключить Wahoo' })).toBeOnTheScreen();
    expect(screen.queryByText('Garmin подключён')).toBeNull();
  });

  it('подключение (native): браузер авторизации → тикет → `complete` → «Garmin подключён» → «Продолжить» → Главная', async () => {
    jest
      .mocked(api.connectDevice)
      .mockResolvedValue({ authorizeUrl: 'https://ow.example/authorize?x=1' });
    authSession.mockResolvedValue({
      type: 'success',
      url: `pokatim://devices/return?provider=garmin&result=pending&t=${TICKET}`,
    });
    jest
      .mocked(api.completeDevice)
      .mockResolvedValue(deviceList(garmin({ status: 'active' }), wahoo()));
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    await fireEvent.press(await screen.findByRole('button', { name: 'Подключить Garmin' }));

    expect(await screen.findByText('Garmin подключён')).toBeOnTheScreen();
    const [, provider, body] = jest.mocked(api.connectDevice).mock.calls[0] ?? [];
    expect(provider).toBe('garmin');
    // схема — из манифеста сборки (`pokatim://`); renderRouter подставляет свою
    expect(body?.returnUrl).toMatch(/^[a-z]+:\/\/devices\/return$/);
    expect(authSession).toHaveBeenCalledWith('https://ow.example/authorize?x=1', body?.returnUrl);
    expect(api.completeDevice).toHaveBeenCalledWith(liveSession.accessToken, 'garmin', {
      ticket: TICKET,
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Продолжить' }));
    expect(await home()).toBeOnTheScreen();
    expect(completeStep).toHaveBeenCalledWith(liveSession.accessToken, { outcome: 'connected' });
  });

  it('браузер закрыли без возврата — список обновлён, шаг остаётся', async () => {
    jest
      .mocked(api.connectDevice)
      .mockResolvedValue({ authorizeUrl: 'https://ow.example/authorize' });
    authSession.mockResolvedValue({ type: 'cancel' } as Awaited<
      ReturnType<typeof openAuthSessionAsync>
    >);
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    await fireEvent.press(await screen.findByRole('button', { name: 'Подключить Garmin' }));
    await waitFor(() => expect(listDevices).toHaveBeenCalledTimes(2));
    expect(api.completeDevice).not.toHaveBeenCalled();
    expect(await stepTitle()).toBeOnTheScreen();
  });

  it('возврат с `result=error` — «Не удалось подключить. Повторите.» без `complete`', async () => {
    jest
      .mocked(api.connectDevice)
      .mockResolvedValue({ authorizeUrl: 'https://ow.example/authorize' });
    authSession.mockResolvedValue({
      type: 'success',
      url: 'pokatim://devices/return?provider=garmin&result=error',
    });
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: false });

    await fireEvent.press(await screen.findByRole('button', { name: 'Подключить Garmin' }));
    expect(await screen.findByText('Не удалось подключить. Повторите.')).toBeOnTheScreen();
    expect(api.completeDevice).not.toHaveBeenCalled();
  });
});

describe('возврат из авторизации `devices/return` (AC11, AC12)', () => {
  const returnUrl = (query: string) => `/devices/return?${query}`;

  beforeEach(() => {
    storeSurveyCompleted();
    jest.mocked(api.listDevices).mockResolvedValue(deviceList(garmin({ status: 'active' })));
  });

  it('`pending` с тикетом — `complete` под входом, затем «Устройства»', async () => {
    jest.mocked(api.completeDevice).mockResolvedValue(deviceList(garmin({ status: 'active' })));
    const router = await openSignedIn(
      { surveyCompleted: true, devicesStepCompleted: true },
      returnUrl(`provider=garmin&result=pending&t=${TICKET}`),
    );

    await waitFor(() => expect(router.getPathname()).toBe('/settings/devices'));
    expect(api.completeDevice).toHaveBeenCalledTimes(1);
    expect(api.completeDevice).toHaveBeenCalledWith(liveSession.accessToken, 'garmin', {
      ticket: TICKET,
    });
    expect(await screen.findByRole('header', { name: 'Устройства' })).toBeOnTheScreen();
  });

  it.each([
    ['`result=error`', 'provider=garmin&result=error'],
    ['мусорный тикет', 'provider=garmin&result=pending&t=abc'],
    ['чужой провайдер', `provider=strava&result=pending&t=${TICKET}`],
    ['без тикета', 'provider=garmin&result=pending'],
  ])('%s — «Не удалось подключить. Повторите.» без запроса', async (_case, query) => {
    await openSignedIn({ surveyCompleted: true, devicesStepCompleted: true }, returnUrl(query));

    expect(await screen.findByText('Не удалось подключить. Повторите.')).toBeOnTheScreen();
    expect(api.completeDevice).not.toHaveBeenCalled();
  });

  it('`complete` отказал (`DEVICE_LINK_INVALID`) — текст и «Вернуться»', async () => {
    jest
      .mocked(api.completeDevice)
      .mockRejectedValue(new ApiHttpError(400, { code: 'DEVICE_LINK_INVALID', message: 'x' }));
    const router = await openSignedIn(
      { surveyCompleted: true, devicesStepCompleted: true },
      returnUrl(`provider=garmin&result=pending&t=${TICKET}`),
    );

    expect(await screen.findByText('Не удалось подключить. Повторите.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Вернуться' }));
    await waitFor(() => expect(router.getPathname()).toBe('/settings/devices'));
  });

  it('без сессии — «Войдите, чтобы завершить подключение», запроса нет', async () => {
    await renderRouter(appRoutes, {
      initialUrl: returnUrl(`provider=garmin&result=pending&t=${TICKET}`),
    });

    expect(await screen.findByText('Войдите, чтобы завершить подключение')).toBeOnTheScreen();
    expect(api.completeDevice).not.toHaveBeenCalled();
  });
});
