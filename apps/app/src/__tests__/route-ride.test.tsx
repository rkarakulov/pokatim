/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { routeRidesKeys } from '@/features/route-rides/queries';
import { api } from '@/lib/api';

import RouteRideRoute from '../app/routes/rides/[routeId]/[rideId]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';
import {
  ACTIVITY_ID,
  BEST_ID,
  PREVIOUS_ID,
  rideCandidate,
  rideCandidates,
  rideDetail,
  RIDE_ID,
  ROUTE_ID,
} from './route-rides-fixtures';

jest.mock('@/lib/api');

const getRide = jest.mocked(api.getRouteRide);
const checkRide = jest.mocked(api.checkRouteRide);
const listCandidates = jest.mocked(api.listRouteRideCandidates);

const NOW = new Date('2026-10-28T09:00:00Z');
const TOKEN = liveSession.accessToken;
/** 5 октября 2026 по Минску. */
const EARLIER = '2026-10-05T07:00:00.000Z';
const never = () => new Promise<never>(() => undefined);
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const notFound = () => new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' });

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const routes = { ...tabRoutes, 'routes/rides/[routeId]/[rideId]': RouteRideRoute };
const open = (path = `/routes/rides/${ROUTE_ID}/${RIDE_ID}`, client = createTestQueryClient()) =>
  renderRouter(routes, { initialUrl: path, wrapper: createQueryWrapper(client) });

const queued = () => rideDetail({ status: 'queued', elapsedSec: null, checkedAt: null });
const notPassed = () =>
  rideDetail({
    status: 'not_passed',
    reason: 'no_finish',
    elapsedSec: null,
    routeDistanceM: null,
    comparison: {
      best: { id: BEST_ID, elapsedSec: 7_477, rideStartedAt: EARLIER },
      isBest: false,
      deltaToBestSec: null,
      previous: null,
      deltaToPreviousSec: null,
    },
  });
const failed = () =>
  rideDetail({
    status: 'failed',
    failure: 'timeout',
    elapsedSec: null,
    comparison: {
      best: null,
      isBest: false,
      deltaToBestSec: null,
      previous: null,
      deltaToPreviousSec: null,
    },
  });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRide.mockResolvedValue(rideDetail());
  jest.mocked(api.getRouteRideTrack).mockReturnValue(never());
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('«Заезд по маршруту» (route-rides-02, A4)', () => {
  it('гость по прямой ссылке — гард ведёт на регистрацию', async () => {
    const router = await renderRouter(appRoutes, {
      initialUrl: `/routes/rides/${ROUTE_ID}/${RIDE_ID}`,
    });
    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
    expect(getRide).not.toHaveBeenCalled();
  });

  it('пройден лучшим: шапка — название маршрута, время, «Пройден», «Лучший», данные заезда', async () => {
    signedIn();
    await open();
    expect(await screen.findByText('2:04:37')).toBeOnTheScreen();
    expect(getRide).toHaveBeenCalledWith(TOKEN, ROUTE_ID, RIDE_ID);
    expect(screen.getByText('Минское кольцо')).toBeOnTheScreen();
    expect(screen.getByText('Пройден')).toBeOnTheScreen();
    expect(screen.getByText('Лучший')).toBeOnTheScreen();
    expect(screen.getByText('Это ваш лучший заезд')).toBeOnTheScreen();
    expect(screen.getByText('Дистанция по маршруту')).toBeOnTheScreen();
    expect(screen.getByText('86,1 км')).toBeOnTheScreen();
    // данные заезда
    expect(screen.getByText('12 октября, 09:30')).toBeOnTheScreen();
    expect(screen.getByText('Garmin')).toBeOnTheScreen();
    expect(screen.getByText('88,4 км')).toBeOnTheScreen();
    expect(screen.getByText('2:06:40')).toBeOnTheScreen();
  });

  it('пройден не лучшим — «К лучшему: +0:42» и «К предыдущему: −1:05 · 5 октября»', async () => {
    signedIn();
    getRide.mockResolvedValue(
      rideDetail({
        comparison: {
          best: { id: BEST_ID, elapsedSec: 7_435, rideStartedAt: EARLIER },
          isBest: false,
          deltaToBestSec: 42,
          previous: { id: PREVIOUS_ID, elapsedSec: 7_542, rideStartedAt: EARLIER },
          deltaToPreviousSec: -65,
        },
      }),
    );
    await open();
    expect(await screen.findByText('К лучшему: +0:42')).toBeOnTheScreen();
    expect(screen.getByText('К предыдущему: −1:05 · 5 октября')).toBeOnTheScreen();
    expect(screen.queryByText('Лучший')).toBeNull();
  });

  it('проверка идёт — «Проверяем заезд…», опрос 3 с; финал — время и список блока устарел', async () => {
    signedIn();
    const client = createTestQueryClient();
    client.setQueryData(routeRidesKeys.list(ROUTE_ID), null);
    getRide.mockResolvedValueOnce(queued()).mockResolvedValueOnce(queued());
    await open(undefined, client);
    expect(await screen.findByText('Проверяем заезд…')).toBeOnTheScreen();
    expect(screen.getByText('В очереди')).toBeOnTheScreen();
    expect(screen.queryByText('2:04:37')).toBeNull();
    expect(getRide).toHaveBeenCalledTimes(1);

    await advance(3000);
    expect(getRide).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(routeRidesKeys.list(ROUTE_ID))?.isInvalidated).toBe(false);
    await advance(3000);
    expect(await screen.findByText('2:04:37')).toBeOnTheScreen();
    expect(client.getQueryState(routeRidesKeys.list(ROUTE_ID))?.isInvalidated).toBe(true);
    await advance(30_000);
    expect(getRide).toHaveBeenCalledTimes(3);
  });

  it('RC-6: через 2 мин незавершённой проверки — опрос раз в 15 с', async () => {
    signedIn();
    getRide.mockResolvedValue(queued());
    await open();
    expect(await screen.findByText('Проверяем заезд…')).toBeOnTheScreen();
    await advance(120_000);
    // 3 с до 2 мин: первый ответ + 40 опросов
    expect(getRide).toHaveBeenCalledTimes(41);
    await advance(14_000);
    expect(getRide).toHaveBeenCalledTimes(41);
    await advance(1_000);
    expect(getRide).toHaveBeenCalledTimes(42);
  });

  it('не пройден — причина, без времени, «Лучший: …»', async () => {
    signedIn();
    getRide.mockResolvedValue(notPassed());
    await open();
    expect(await screen.findByText('Не пройден')).toBeOnTheScreen();
    expect(screen.getByText('Нет финиша: трек не входит в ворота финиша')).toBeOnTheScreen();
    expect(screen.getByText('Лучший: 2:04:37 · 5 октября')).toBeOnTheScreen();
    expect(screen.queryByText('Дистанция по маршруту')).toBeNull();
  });

  it('сбой — текст кода и «Проверить снова»: кандидат найден → POST { activityId }', async () => {
    signedIn();
    getRide.mockResolvedValue(failed());
    listCandidates.mockResolvedValue(rideCandidates(rideCandidate({ rideId: RIDE_ID })));
    checkRide.mockResolvedValue(queued());
    await open();
    expect(await screen.findByText('Проверка не уложилась во время')).toBeOnTheScreen();
    expect(screen.getByText('Не удалось проверить')).toBeOnTheScreen();
    expect(listCandidates).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Проверить снова' }));
    await waitFor(() =>
      expect(checkRide).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { activityId: ACTIVITY_ID }),
    );
    // ответ — в кеш: экран остаётся и показывает проверку
    expect(await screen.findByText('Проверяем заезд…')).toBeOnTheScreen();
  });

  it('«Проверить снова» без кандидата — подсказка загрузить файл, без POST', async () => {
    signedIn();
    getRide.mockResolvedValue(failed());
    listCandidates.mockResolvedValue(rideCandidates(rideCandidate({ rideId: null })));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Проверить снова' }));
    expect(
      await screen.findByText('Заезда нет среди доступных — загрузите файл заезда ещё раз'),
    ).toBeOnTheScreen();
    expect(checkRide).not.toHaveBeenCalled();
  });

  it('«Проверить снова» — ошибка POST (429) текстом ошибок заезда', async () => {
    signedIn();
    getRide.mockResolvedValue(failed());
    listCandidates.mockResolvedValue(rideCandidates(rideCandidate({ rideId: RIDE_ID })));
    checkRide.mockRejectedValue(
      new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 30 } }),
    );
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Проверить снова' }));
    expect(
      await screen.findByText('Слишком много проверок за час. Попробуйте через 1 мин.'),
    ).toBeOnTheScreen();
  });

  it('незнакомый статус — «Статус неизвестен» без действий', async () => {
    signedIn();
    getRide.mockResolvedValue(rideDetail({ status: 'unknown', elapsedSec: null }));
    await open();
    expect(await screen.findByText('Статус неизвестен')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Проверить снова' })).toBeNull();
    expect(screen.queryByText('Проверяем заезд…')).toBeNull();
  });

  it('404 — «Заезд не найден» + «К маршруту» (каталог)', async () => {
    signedIn();
    getRide.mockRejectedValue(notFound());
    const router = await open();
    expect(await screen.findByText('Заезд не найден')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К маршруту' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/${ROUTE_ID}`));
  });

  it('невалидный id — «Заезд не найден» без запроса; «К маршруту» своего — /routes/mine/<id>', async () => {
    signedIn();
    const router = await renderRouter(
      { ...routes, 'routes/mine/[id]': () => null },
      {
        initialUrl: `/routes/rides/${ROUTE_ID}/nope?mine=1`,
        wrapper: createQueryWrapper(),
      },
    );
    expect(await screen.findByText('Заезд не найден')).toBeOnTheScreen();
    expect(getRide).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'К маршруту' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/mine/${ROUTE_ID}`));
  });
});
