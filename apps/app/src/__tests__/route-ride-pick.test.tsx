/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { getDocumentAsync } from 'expo-document-picker';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { routeRidesKeys } from '@/features/route-rides/queries';
import { api } from '@/lib/api';

import RouteRideRoute from '../app/routes/rides/[routeId]/[rideId]';
import RouteRidePickRoute from '../app/routes/pick/[routeId]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { FakeXhr } from './fake-xhr';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';
import {
  rideCandidate,
  rideCandidates,
  rideDetail,
  RIDE_ID,
  ROUTE_ID,
  trackUpload,
  UPLOAD_ID,
} from './route-rides-fixtures';

jest.mock('@/lib/api');
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const listCandidates = jest.mocked(api.listRouteRideCandidates);
const checkRide = jest.mocked(api.checkRouteRide);
const getRide = jest.mocked(api.getRouteRide);
const getUpload = jest.mocked(api.getTrackUpload);

/** 28 октября 2026, 12:00 по Минску. */
const NOW = new Date('2026-10-28T09:00:00Z');
const TOKEN = liveSession.accessToken;
const OTHER_ACTIVITY = '0199d000-0000-7000-8000-0000000000a2';
const never = () => new Promise<never>(() => undefined);
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const routes = {
  ...tabRoutes,
  'routes/pick/[routeId]': RouteRidePickRoute,
  'routes/rides/[routeId]/[rideId]': RouteRideRoute,
};
const openPick = (id = ROUTE_ID, client = createTestQueryClient()) =>
  renderRouter(routes, {
    initialUrl: `/routes/pick/${id}`,
    wrapper: createQueryWrapper(client),
  });

const checkedLabel = '12 октября, 09:30 · Garmin · 88,4 км · 2:06:40 · Уже проверен';
const freeLabel = '7 октября, 08:00 · Файл · 40 км · 1:30:00';

const pickFile = () => {
  jest.mocked(getDocumentAsync).mockResolvedValue({
    canceled: false,
    assets: [{ name: 'ride.gpx', size: 1024, uri: 'file:///cache/ride.gpx', lastModified: 0 }],
  });
  jest.mocked(api.trackUploadRequest).mockReturnValue({
    url: 'https://api.example/v1/tracks/uploads?name=ride.gpx',
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' },
  });
  FakeXhr.last = undefined;
  global.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  global.fetch = jest.fn(async () => ({ blob: async () => ({ size: 1024 }) })) as never;
};
/** «Загрузить заезд» → файл отправлен, ответ сервера — `upload`. */
const uploadFile = async (status: number, upload = trackUpload()) => {
  await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить заезд' }));
  await waitFor(() => expect(FakeXhr.last).toBeDefined());
  await act(async () => FakeXhr.last?.respond(status, upload));
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  listCandidates.mockResolvedValue(
    rideCandidates(
      rideCandidate({ rideId: RIDE_ID }),
      rideCandidate({
        activityId: OTHER_ACTIVITY,
        // 7 октября, 08:00 по Минску
        startedAt: '2026-10-07T05:00:00Z',
        source: 'upload',
        elapsedSec: 5400,
        distanceM: 40_000,
      }),
    ),
  );
  checkRide.mockResolvedValue(rideDetail({ status: 'queued', checkedAt: null }));
  getRide.mockResolvedValue(rideDetail());
  jest.mocked(api.getRouteRideTrack).mockReturnValue(never());
});
const realXhr = global.XMLHttpRequest;
const realFetch = global.fetch;
afterEach(() => {
  global.XMLHttpRequest = realXhr;
  global.fetch = realFetch;
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('«Выбрать свой заезд» для маршрута (route-rides-02, A3)', () => {
  it('гость по прямой ссылке — гард ведёт на лендинг, без запросов', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/routes/pick/${ROUTE_ID}` });
    expect(
      await screen.findByRole('header', {
        name: 'Катайтесь вместе и соревнуйтесь на своих маршрутах',
      }),
    ).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/welcome');
    expect(listCandidates).not.toHaveBeenCalled();
  });

  it('RC-3: /routes/pick/<uuid> в полном приложении — экран выбора, не «Заезд не найден»', async () => {
    signedIn();
    await renderRouter(appRoutes, { initialUrl: `/routes/pick/${ROUTE_ID}` });
    expect(await screen.findByRole('header', { name: 'Выбрать свой заезд' })).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: freeLabel })).toBeOnTheScreen();
    expect(screen.queryByText('Заезд не найден')).toBeNull();
    expect(listCandidates).toHaveBeenCalledWith(TOKEN, ROUTE_ID);
  });

  it('заголовок сразу, на месте списка — скелетон', async () => {
    signedIn();
    listCandidates.mockReturnValueOnce(never());
    await openPick();
    expect(await screen.findByRole('header', { name: 'Выбрать свой заезд' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
  });

  it('уже проверенный — «Уже проверен», переход на его результат без POST', async () => {
    signedIn();
    const router = await openPick();
    expect(await screen.findByText('Уже проверен')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: checkedLabel }));
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(checkRide).not.toHaveBeenCalled();
  });

  it('кандидат → POST { activityId } → результат из кэша ответа (без GET), список устарел', async () => {
    signedIn();
    const client = createTestQueryClient();
    client.setQueryData(routeRidesKeys.list(ROUTE_ID), null);
    let resolve: (value: ReturnType<typeof rideDetail>) => void = () => undefined;
    checkRide.mockReturnValue(new Promise((done) => (resolve = done)));
    const router = await openPick(ROUTE_ID, client);

    await fireEvent.press(await screen.findByRole('button', { name: freeLabel }));
    expect(checkRide).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { activityId: OTHER_ACTIVITY });
    // на время POST — все строки выключены, «Загрузить заезд» скрыт
    await waitFor(() => expect(screen.getByRole('button', { name: freeLabel })).toBeDisabled());
    expect(screen.getByRole('button', { name: checkedLabel })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Загрузить заезд' })).toBeNull();

    await act(async () => resolve(rideDetail({ status: 'queued', checkedAt: null })));
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(await screen.findByText('Проверяем заезд…')).toBeOnTheScreen();
    expect(getRide).not.toHaveBeenCalled();
    expect(client.getQueryState(routeRidesKeys.list(ROUTE_ID))?.isInvalidated).toBe(true);
  });

  it('свой маршрут (?mine=1) — результат тоже с ?mine=1', async () => {
    signedIn();
    const router = await renderRouter(routes, {
      initialUrl: `/routes/pick/${ROUTE_ID}?mine=1`,
      wrapper: createQueryWrapper(),
    });
    await fireEvent.press(await screen.findByRole('button', { name: freeLabel }));
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(router.getSearchParams()).toMatchObject({ mine: '1' });
  });

  it.each([
    [
      '409 квоты',
      new ApiHttpError(409, { code: 'ROUTE_RIDE_QUOTA_EXCEEDED', message: 'x' }),
      'По этому маршруту уже 100 заездов — это предел',
    ],
    [
      '429',
      new ApiHttpError(429, {
        code: 'RATE_LIMITED',
        message: 'x',
        details: { retryAfterSec: 2400 },
      }),
      'Слишком много проверок за час. Попробуйте через 40 мин.',
    ],
  ])('ошибка POST (%s) — баннер с текстом, экран остаётся', async (_case, error, text) => {
    signedIn();
    checkRide.mockRejectedValue(error);
    const router = await openPick();

    await fireEvent.press(await screen.findByRole('button', { name: freeLabel }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/routes/pick/${ROUTE_ID}`);
  });

  it('пусто — «Подходящих заездов нет» и «Загрузить заезд»', async () => {
    signedIn();
    listCandidates.mockResolvedValue(rideCandidates());
    await openPick();
    expect(await screen.findByText('Подходящих заездов нет')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Загрузить заезд' })).toBeOnTheScreen();
  });

  it('над непустым списком — «Загрузить заезд»', async () => {
    signedIn();
    await openPick();
    expect(await screen.findByRole('button', { name: freeLabel })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Загрузить заезд' })).toBeOnTheScreen();
  });

  it('ошибка без данных — «Нет соединения» с повтором', async () => {
    signedIn();
    listCandidates.mockRejectedValueOnce(new ApiNetworkError(new TypeError('x')));
    await openPick();
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: freeLabel })).toBeOnTheScreen();
  });

  it('404 кандидатов (маршрут стал невидим) — «Маршрут недоступен» без «Повторить»', async () => {
    signedIn();
    listCandidates.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await openPick();
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Загрузить заезд' })).toBeNull();
  });

  it('невалидный routeId — «Маршрут недоступен» без запросов', async () => {
    signedIn();
    await openPick('nope');
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(listCandidates).not.toHaveBeenCalled();
  });
});

describe('загрузка файла для проверки по маршруту (RC-1)', () => {
  it('ответ загрузки ready — сразу один POST { uploadId } и результат', async () => {
    signedIn();
    pickFile();
    const router = await openPick();

    await uploadFile(200, trackUpload({ status: 'ready' }));
    await waitFor(() =>
      expect(checkRide).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { uploadId: UPLOAD_ID }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(checkRide).toHaveBeenCalledTimes(1);
    expect(getUpload).not.toHaveBeenCalled();
  });

  it('processing → опрос getTrackUpload раз в 2 с → ready → ровно один POST', async () => {
    signedIn();
    pickFile();
    getUpload
      .mockResolvedValueOnce(trackUpload({ status: 'processing' }))
      .mockResolvedValue(trackUpload({ status: 'ready' }));
    const router = await openPick();

    await uploadFile(202, trackUpload({ status: 'queued' }));
    expect(await screen.findByText('Обрабатываем файл…')).toBeOnTheScreen();
    expect(checkRide).not.toHaveBeenCalled();

    await advance(2000);
    expect(getUpload).toHaveBeenCalledWith(TOKEN, UPLOAD_ID);
    expect(checkRide).not.toHaveBeenCalled();
    await advance(2000);
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(checkRide).toHaveBeenCalledTimes(1);
    expect(checkRide).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { uploadId: UPLOAD_ID });
  });

  it('failed — «Файл не принят: …» без POST', async () => {
    signedIn();
    pickFile();
    getUpload.mockResolvedValue(trackUpload({ status: 'failed', failure: 'no_track' }));
    await openPick();

    await uploadFile(202, trackUpload({ status: 'queued' }));
    await advance(2000);
    expect(await screen.findByText('Файл не принят: В файле нет трека')).toBeOnTheScreen();
    await advance(10_000);
    expect(checkRide).not.toHaveBeenCalled();
  });

  it('60 с без финала — «откройте выбор позже», POST не вызывался, опрос остановлен', async () => {
    signedIn();
    pickFile();
    getUpload.mockResolvedValue(trackUpload({ status: 'processing' }));
    await openPick();

    await uploadFile(202, trackUpload({ status: 'queued' }));
    await advance(60_000);
    expect(
      await screen.findByText('Файл ещё обрабатывается — откройте выбор позже'),
    ).toBeOnTheScreen();
    const polls = getUpload.mock.calls.length;
    expect(polls).toBeGreaterThan(0);
    await advance(10_000);
    expect(getUpload).toHaveBeenCalledTimes(polls);
    expect(checkRide).not.toHaveBeenCalled();
  });

  it('POST ответил NOT_READY — один повтор через 2 с, затем баннер (всего 2 POST)', async () => {
    signedIn();
    pickFile();
    checkRide.mockRejectedValue(
      new ApiHttpError(409, { code: 'ROUTE_RIDE_NOT_READY', message: 'x' }),
    );
    await openPick();

    await uploadFile(200, trackUpload({ status: 'duplicate' }));
    await waitFor(() => expect(checkRide).toHaveBeenCalledTimes(1));
    await advance(2000);
    expect(
      await screen.findByText('Файл ещё обрабатывается — откройте выбор позже'),
    ).toBeOnTheScreen();
    await advance(10_000);
    expect(checkRide).toHaveBeenCalledTimes(2);
  });

  it('повтор того же файла после таймаута: загрузка уже готова — один POST и результат (ревью pass 1)', async () => {
    signedIn();
    pickFile();
    getUpload.mockResolvedValue(trackUpload({ status: 'processing' }));
    const router = await openPick();

    await uploadFile(202, trackUpload({ status: 'queued' }));
    await advance(60_000);
    expect(
      await screen.findByText('Файл ещё обрабатывается — откройте выбор позже'),
    ).toBeOnTheScreen();
    expect(checkRide).not.toHaveBeenCalled();

    // сервер дообработал файл; повтор того же файла — тот же uploadId уже `ready`
    FakeXhr.last = undefined;
    await uploadFile(200, trackUpload({ status: 'ready' }));
    await waitFor(() =>
      expect(checkRide).toHaveBeenCalledWith(TOKEN, ROUTE_ID, { uploadId: UPLOAD_ID }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(checkRide).toHaveBeenCalledTimes(1);
  });

  it('ошибка опроса статуса файла — баннер с повтором; повтор без новой отправки доводит до POST', async () => {
    signedIn();
    pickFile();
    getUpload
      .mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }))
      .mockResolvedValue(trackUpload({ status: 'ready' }));
    const router = await openPick();

    await uploadFile(202, trackUpload({ status: 'queued' }));
    await advance(2000);
    expect(await screen.findByText('Не удалось узнать статус файла')).toBeOnTheScreen();
    expect(screen.getByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.queryByText('Обрабатываем файл…')).toBeNull();
    const xhr = FakeXhr.last;

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(checkRide).toHaveBeenCalledTimes(1);
    expect(FakeXhr.last).toBe(xhr);
  });

  it('ошибка опроса останавливает опрос: без «Повторить» — ни GET, ни POST; повтор возобновляет с новым окном 60 с (Codex pass 2)', async () => {
    signedIn();
    pickFile();
    getUpload
      .mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }))
      .mockResolvedValueOnce(trackUpload({ status: 'processing' }))
      .mockResolvedValue(trackUpload({ status: 'ready' }));
    const router = await openPick();

    await uploadFile(202, trackUpload({ status: 'queued' }));
    await advance(2000);
    expect(await screen.findByText('Не удалось узнать статус файла')).toBeOnTheScreen();
    expect(getUpload).toHaveBeenCalledTimes(1);
    // без нажатия — опрос стоит, таймаута «откройте выбор позже» нет
    await advance(90_000);
    expect(getUpload).toHaveBeenCalledTimes(1);
    expect(checkRide).not.toHaveBeenCalled();
    expect(screen.queryByText('Файл ещё обрабатывается — откройте выбор позже')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Обрабатываем файл…')).toBeOnTheScreen();
    expect(getUpload).toHaveBeenCalledTimes(2);
    await advance(2000);
    await waitFor(() => expect(router.getPathname()).toBe(`/routes/rides/${ROUTE_ID}/${RIDE_ID}`));
    expect(getUpload).toHaveBeenCalledTimes(3);
    expect(checkRide).toHaveBeenCalledTimes(1);
  });

  it('уход с экрана во время опроса — запросов больше нет', async () => {
    signedIn();
    pickFile();
    getUpload.mockResolvedValue(trackUpload({ status: 'processing' }));
    const view = await openPick();

    await uploadFile(202, trackUpload({ status: 'queued' }));
    await advance(2000);
    const polls = getUpload.mock.calls.length;
    view.unmount();
    await advance(30_000);
    expect(getUpload).toHaveBeenCalledTimes(polls);
    expect(checkRide).not.toHaveBeenCalled();
  });
});
