/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { RouteRideDetail } from '@pokatim/contracts';
import { formatElapsed } from '@pokatim/i18n';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

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
  rideDetail,
  RIDE_ID,
  rideSection,
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
  it('гость по прямой ссылке — гард ведёт на лендинг', async () => {
    const router = await renderRouter(appRoutes, {
      initialUrl: `/routes/rides/${ROUTE_ID}/${RIDE_ID}`,
    });
    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
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

  it('проверка идёт — «Проверяем заезд…», опрос 3 с; финал — время, список блока и таблица «Другие» устарели', async () => {
    signedIn();
    const client = createTestQueryClient();
    client.setQueryData(routeRidesKeys.list(ROUTE_ID), null);
    client.setQueryData(routeRidesKeys.leaderboard(ROUTE_ID, 5), null);
    getRide.mockResolvedValueOnce(queued()).mockResolvedValueOnce(queued());
    await open(undefined, client);
    expect(await screen.findByText('Проверяем заезд…')).toBeOnTheScreen();
    expect(screen.getByText('В очереди')).toBeOnTheScreen();
    expect(screen.queryByText('2:04:37')).toBeNull();
    expect(getRide).toHaveBeenCalledTimes(1);

    await advance(3000);
    expect(getRide).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(routeRidesKeys.list(ROUTE_ID))?.isInvalidated).toBe(false);
    expect(client.getQueryState(routeRidesKeys.leaderboard(ROUTE_ID, 5))?.isInvalidated).toBe(
      false,
    );
    await advance(3000);
    expect(await screen.findByText('2:04:37')).toBeOnTheScreen();
    expect(client.getQueryState(routeRidesKeys.list(ROUTE_ID))?.isInvalidated).toBe(true);
    // route-rides-04 (RC-B6): своя строка таблицы «Другие» могла смениться
    expect(client.getQueryState(routeRidesKeys.leaderboard(ROUTE_ID, 5))?.isInvalidated).toBe(true);
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

  it('сбой — текст кода и «Проверить снова»: POST { activityId } детали, без запроса кандидатов', async () => {
    signedIn();
    getRide.mockResolvedValue(failed());
    checkRide.mockResolvedValue(queued());
    await open();
    expect(await screen.findByText('Проверка не уложилась во время')).toBeOnTheScreen();
    expect(screen.getByText('Не удалось проверить')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Проверить снова' }));
    await waitFor(() =>
      expect(checkRide).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { activityId: ACTIVITY_ID }),
    );
    expect(listCandidates).not.toHaveBeenCalled();
    // ответ — в кеш: экран остаётся и показывает проверку
    expect(await screen.findByText('Проверяем заезд…')).toBeOnTheScreen();
  });

  it('«Проверить снова» — 404 (активности больше нет): подсказка загрузить файл', async () => {
    signedIn();
    getRide.mockResolvedValue(failed());
    checkRide.mockRejectedValue(notFound());
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Проверить снова' }));
    expect(
      await screen.findByText('Заезда нет среди доступных — загрузите файл заезда ещё раз'),
    ).toBeOnTheScreen();
    expect(listCandidates).not.toHaveBeenCalled();
  });

  it('«Проверить снова» — без activityId (старый API) кнопки нет', async () => {
    signedIn();
    getRide.mockResolvedValue({ ...failed(), activityId: null });
    await open();
    expect(await screen.findByText('Проверка не уложилась во время')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Проверить снова' })).toBeNull();
  });

  it('«Проверить снова» — ошибка POST (429) текстом ошибок заезда', async () => {
    signedIn();
    getRide.mockResolvedValue(failed());
    checkRide.mockRejectedValue(
      new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 30 } }),
    );
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Проверить снова' }));
    expect(
      await screen.findByText('Слишком много проверок за час. Попробуйте через 1 мин.'),
    ).toBeOnTheScreen();
  });

  it('автопроверка (route-rides-03) — «Проверен автоматически»', async () => {
    signedIn();
    getRide.mockResolvedValue(rideDetail({ origin: 'auto' }));
    await open();
    expect(await screen.findByText('Проверен автоматически')).toBeOnTheScreen();
  });

  it('ручная проверка — без строки «Проверен автоматически»', async () => {
    signedIn();
    await open();
    expect(await screen.findByText('2:04:37')).toBeOnTheScreen();
    expect(screen.queryByText('Проверен автоматически')).toBeNull();
  });

  it('pull-to-refresh — деталь перезапрашивается (ревью pass 1)', async () => {
    signedIn();
    await open();
    expect(await screen.findByText('2:04:37')).toBeOnTheScreen();
    expect(getRide).toHaveBeenCalledTimes(1);
    const control = screen.getByTestId('route-ride').props
      .refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      await control.props.onRefresh?.();
    });
    expect(getRide).toHaveBeenCalledTimes(2);
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

describe('участки заезда (route-rides-05 B)', () => {
  const hint =
    'Время участков не складывается во время маршрута: края у границ участков не входят ни в один из них.';
  const missed = (fromM: number, toM: number, bestElapsedSec: number | null = null) =>
    rideSection({
      fromM,
      toM,
      status: 'not_passed',
      elapsedSec: null,
      isBest: false,
      bestElapsedSec,
      deltaToBestSec: null,
    });
  const threeSections = [
    rideSection(),
    rideSection({
      fromM: 10_000,
      toM: 24_999,
      elapsedSec: 1_500,
      isBest: false,
      bestElapsedSec: 1_458,
      deltaToBestSec: 42,
    }),
    missed(24_999, 36_000, 1_200),
  ];
  /** Позиции текстов в порядке дерева экрана. */
  const order = (...texts: string[]) => {
    const flat: string[] = [];
    const walk = (node: ReturnType<typeof screen.getByTestId> | string) => {
      if (typeof node === 'string') flat.push(node);
      else node.children.forEach(walk);
    };
    walk(screen.getByTestId('route-ride'));
    return texts.map((text) => flat.indexOf(text));
  };

  it('пройден с тремя участками — блок после сравнения и до «Ваш заезд»: сводка, пояснение, строки; суммы нет', async () => {
    signedIn();
    getRide.mockResolvedValue(rideDetail({ sections: threeSections }));
    await open();
    expect(await screen.findByTestId('route-ride-sections')).toBeOnTheScreen();
    expect(screen.getByText('Участки')).toBeOnTheScreen();
    expect(screen.getByText('Пройдено участков: 2 из 3')).toBeOnTheScreen();
    expect(screen.getByText(hint)).toBeOnTheScreen();
    expect(screen.getByText('Участок 1 · 0–10 км')).toBeOnTheScreen();
    expect(screen.getByText('0:18:04')).toBeOnTheScreen();
    expect(screen.getByText('Участок 2 · 10–25 км')).toBeOnTheScreen();
    expect(screen.getByText('0:25:00')).toBeOnTheScreen();
    expect(screen.getByText('К лучшему: +0:42')).toBeOnTheScreen();
    expect(screen.getByText('Не пройден')).toBeOnTheScreen();
    expect(screen.getByText('Лучшее время: 0:20:00')).toBeOnTheScreen();
    expect(screen.getByTestId('route-ride-section-1')).toHaveProp(
      'accessibilityLabel',
      'Участок 1 · 0–10 км · 0:18:04 · Лучший',
    );
    expect(screen.getByTestId('route-ride-section-2')).toHaveProp(
      'accessibilityLabel',
      'Участок 2 · 10–25 км · 0:25:00 · К лучшему: +0:42',
    );
    expect(screen.getByTestId('route-ride-section-3')).toHaveProp(
      'accessibilityLabel',
      'Участок 3 · 25–36 км · Не пройден · Лучшее время: 0:20:00',
    );
    // RC-2: суммы времён пройденных нет ни текстом, ни в подписях
    const sum = formatElapsed(1_084 + 1_500);
    expect(screen.queryByText(new RegExp(sum))).toBeNull();
    expect(screen.queryByLabelText(new RegExp(sum))).toBeNull();
    const [isBest, sections, ride] = order('Это ваш лучший заезд', 'Участки', 'Ваш заезд');
    expect(isBest).toBeGreaterThan(-1);
    expect(sections).toBeGreaterThan(isBest);
    expect(ride).toBeGreaterThan(sections);
  });

  it('не пройден с первым зачтённым участком — вердикт, причина, «Лучший: …» маршрута и время участка 1', async () => {
    signedIn();
    getRide.mockResolvedValue(
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
        sections: [rideSection(), missed(10_000, 20_000), missed(20_000, 30_000)],
      }),
    );
    await open();
    expect(await screen.findByTestId('route-ride-sections')).toBeOnTheScreen();
    expect(screen.getByText('Нет финиша: трек не входит в ворота финиша')).toBeOnTheScreen();
    expect(screen.getByText('Лучший: 2:04:37 · 5 октября')).toBeOnTheScreen();
    expect(screen.getByText('Пройдено участков: 1 из 3')).toBeOnTheScreen();
    expect(screen.getByText('0:18:04')).toBeOnTheScreen();
    // вердикт «Не пройден» + две строки участков
    expect(screen.getAllByText('Не пройден')).toHaveLength(3);
    expect(screen.queryByText(/Лучшее время/)).toBeNull();
  });

  it('пустой список — блока нет, без подписей', async () => {
    signedIn();
    await open();
    expect(await screen.findByText('Это ваш лучший заезд')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-ride-sections')).toBeNull();
    expect(screen.queryByText('Участки')).toBeNull();
  });

  it('сбой (сервер отдаёт пустой список) — блока нет', async () => {
    signedIn();
    getRide.mockResolvedValue(failed());
    await open();
    expect(await screen.findByText('Проверить снова')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-ride-sections')).toBeNull();
  });

  it('проверка идёт с участками в ответе — блока нет; после финала (опрос) — появился', async () => {
    signedIn();
    getRide
      .mockResolvedValueOnce(
        rideDetail({ status: 'checking', elapsedSec: null, sections: threeSections }),
      )
      .mockResolvedValue(rideDetail({ sections: threeSections }));
    await open();
    expect(await screen.findByText('Проверяем заезд…')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-ride-sections')).toBeNull();
    await advance(3000);
    expect(await screen.findByTestId('route-ride-sections')).toBeOnTheScreen();
  });

  it('незнакомый статус участка (разбор схемы) — «Статус неизвестен» без времени', async () => {
    signedIn();
    getRide.mockResolvedValue(
      RouteRideDetail.parse({
        ...rideDetail(),
        sections: [{ ...rideSection(), status: 'x', elapsedSec: null, isBest: false }],
      }),
    );
    await open();
    expect(await screen.findByTestId('route-ride-sections')).toBeOnTheScreen();
    expect(screen.getByText('Статус неизвестен')).toBeOnTheScreen();
    expect(screen.getByText('Пройдено участков: 0 из 1')).toBeOnTheScreen();
  });

  it('старый ответ без поля sections — экран без блока, без ошибок', async () => {
    signedIn();
    const { sections: _omit, ...legacy } = rideDetail();
    getRide.mockResolvedValue(RouteRideDetail.parse(legacy));
    await open();
    expect(await screen.findByText('Это ваш лучший заезд')).toBeOnTheScreen();
    expect(screen.queryByTestId('route-ride-sections')).toBeNull();
  });
});
