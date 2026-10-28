/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { MyRoute, MyRoutePage, RouteMapGeometry } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDocumentAsync } from 'expo-document-picker';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import MyRouteRoute from '../app/routes/mine/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { FakeXhr } from './fake-xhr';
import { createQueryWrapper } from './query-wrapper';
import { ridesPage } from './route-rides-fixtures';

jest.mock('@/lib/api');
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const listMine = jest.mocked(api.listMyRoutes);
const getMine = jest.mocked(api.getMyRoute);
const getMineMap = jest.mocked(api.getMyRouteMap);
const renameMine = jest.mocked(api.renameMyRoute);
const deleteMine = jest.mocked(api.deleteMyRoute);
const listCatalog = jest.mocked(api.listCatalogRoutes);
const pick = jest.mocked(getDocumentAsync);

const NOW = new Date('2026-10-27T09:00:00Z');
const TOKEN = liveSession.accessToken;
const UPLOAD_URL = 'https://api.example/v1/routes/mine?title=x';
const LIGHT = 'https://tiles.example/styles/positron';
const never = () => new Promise<never>(() => undefined);
const http = (status: number, code: string) => new ApiHttpError(status, { code, message: 'x' });

let seq = 0;
const mine = (overrides: Partial<MyRoute> = {}): MyRoute => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`,
  title: `Мой маршрут ${seq}`,
  status: 'ready',
  failure: null,
  distanceM: 42_000,
  elevationGainM: 310,
  isLoop: true,
  createdAt: '2026-10-26T21:30:00.000Z',
  publication: null,
  canPublish: false,
  submissionsExhausted: false,
  ...overrides,
});
const page = (items: MyRoute[], nextCursor: string | null = null): MyRoutePage => ({
  items,
  nextCursor,
});
const geometry: RouteMapGeometry = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
};

const ring = mine({ title: 'Вечерний круг' });
const ringLabel = 'Вечерний круг. 42 км · набор 310 м · петля · 27 октября 2026';

const realXhr = global.XMLHttpRequest;
const realFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
  process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
  listMine.mockResolvedValue(page([ring]));
  listCatalog.mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCatalogRouteCities).mockResolvedValue({ cities: [] });
  getMine.mockResolvedValue(ring);
  getMineMap.mockResolvedValue(geometry);
  // route-rides-02 (RC-12): «Мои заезды» вошедшего — по умолчанию пусто (автомок вернул бы undefined)
  jest.mocked(api.listRouteRides).mockResolvedValue(ridesPage());
  jest.mocked(api.myRouteUploadRequest).mockReturnValue({
    url: UPLOAD_URL,
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' },
  });
  FakeXhr.last = undefined;
  global.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  // копия файла в кеше приложения читается в Blob (native)
  global.fetch = jest.fn(async () => ({ blob: async () => ({ size: 1024 }) })) as never;
});
afterEach(() => {
  global.XMLHttpRequest = realXhr;
  global.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
  delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const routes = { ...tabRoutes, 'routes/mine/[id]': MyRouteRoute };
const openTab = (url = '/routes?view=mine') =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });
const picked = (name: string, size: number) =>
  pick.mockResolvedValue({
    canceled: false,
    assets: [{ name, size, uri: `file:///cache/${name}`, lastModified: 0 }],
  });
const feed = () => screen.getByTestId('my-routes-feed');

describe('переключатель «Каталог / Мои» (routes-02, M1)', () => {
  it('по умолчанию — «Каталог» с фильтрами; «Мои» — ?view=mine без фильтров; «Каталог» — обратно', async () => {
    const router = await openTab('/routes');
    expect(await screen.findByRole('tab', { name: 'Каталог' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'до 50 км' })).toBeOnTheScreen();
    expect(listMine).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('tab', { name: 'Мои' }));
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
    expect(router.getSearchParams()).toMatchObject({ view: 'mine' });
    expect(screen.queryByRole('button', { name: 'до 50 км' })).toBeNull();
    expect(listMine).toHaveBeenCalledWith(TOKEN, { limit: 20 });

    await fireEvent.press(screen.getByRole('tab', { name: 'Каталог' }));
    expect(await screen.findByRole('button', { name: 'до 50 км' })).toBeOnTheScreen();
  });

  it('?view=mine в адресе открывает «Мои»', async () => {
    await openTab();
    expect(await screen.findByRole('tab', { name: 'Мои' })).toBeSelected();
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
  });
});

describe('лента «Мои маршруты»', () => {
  it('загрузка: заголовок и переключатель сразу, на месте данных — скелетон', async () => {
    listMine.mockReturnValue(never());
    await openTab();
    expect(screen.getByRole('header', { name: 'Маршруты' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Мои' })).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка').length).toBeGreaterThanOrEqual(1);
    // загрузка файла не ждёт списка (findings pass 2)
    expect(screen.getByRole('button', { name: 'Загрузить маршрут' })).toBeOnTheScreen();
  });

  it('пусто — «У вас пока нет маршрутов» и «Загрузить маршрут»', async () => {
    listMine.mockResolvedValue(page([]));
    await openTab();
    expect(await screen.findByText('У вас пока нет маршрутов')).toBeOnTheScreen();
    // одна кнопка — в пустом состоянии
    expect(screen.getAllByRole('button', { name: 'Загрузить маршрут' })).toHaveLength(1);
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('x')), 'Нет соединения'],
    ['сбой API', http(500, 'INTERNAL'), 'Не удалось загрузить'],
  ])('ошибка без данных (%s) — «%s» с повтором', async (_case, error, title) => {
    listMine.mockRejectedValueOnce(error);
    await openTab();
    expect(await screen.findByText(title)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Загрузить маршрут' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
  });

  it('статусы карточек; опрос раз в 3 с при «Обрабатывается», стоп при готовности; карточка ведёт в /routes/mine/<id>', async () => {
    const pending = mine({ title: 'Новый', status: 'processing', distanceM: null, isLoop: null });
    listMine.mockResolvedValue(page([pending, mine({ status: 'failed', failure: 'no_track' })]));
    const router = await openTab();
    expect(await screen.findByText('Обрабатывается')).toBeOnTheScreen();
    expect(screen.getByText('В файле нет линии маршрута')).toBeOnTheScreen();

    const before = listMine.mock.calls.length;
    listMine.mockResolvedValue(
      page([{ ...pending, status: 'ready', distanceM: 42_000, isLoop: true }]),
    );
    await act(() => jest.advanceTimersByTimeAsync(3000));
    expect(listMine.mock.calls.length).toBeGreaterThan(before);
    await waitFor(() => expect(screen.queryByText('Обрабатывается')).toBeNull());
    const settled = listMine.mock.calls.length;
    await act(() => jest.advanceTimersByTimeAsync(10_000));
    expect(listMine).toHaveBeenCalledTimes(settled);

    await fireEvent.press(screen.getByRole('link', { name: /^Новый\./ }));
    expect(router.getPathname()).toBe(`/routes/mine/${pending.id}`);
  });

  it('догрузка по курсору; ошибка обновления при данных — данные остаются', async () => {
    listMine.mockImplementation((_token, params = {}) =>
      Promise.resolve(params.cursor ? page([mine({ title: 'Догружен' })]) : page([ring], 'c2')),
    );
    await openTab();
    await screen.findByRole('link', { name: ringLabel });
    await act(async () => {
      feed().props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(await screen.findByText('Догружен')).toBeOnTheScreen();
    expect(listMine).toHaveBeenLastCalledWith(TOKEN, { limit: 20, cursor: 'c2' });
  });
});

describe('загрузка своего маршрута (AC1, AC2)', () => {
  it.each([
    ['route.kmz', 1024, 'Формат не поддерживается — выберите GPX или KML'],
    ['course.fit', 1024, 'Формат не поддерживается — выберите GPX или KML'],
    ['big.gpx', 5 * 1024 * 1024 + 1, 'Файл слишком большой — до 5 МБ'],
  ])('pre-check: %s — «%s» без запроса', async (name, size, message) => {
    picked(name, size);
    await openTab();
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить маршрут' }));
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(api.myRouteUploadRequest).not.toHaveBeenCalled();
    expect(FakeXhr.last).toBeUndefined();
  });

  it('название по умолчанию — имя файла; 2 символа — ошибка под полем без запроса; отправка с прогрессом; успех — в начале списка', async () => {
    picked('Кольцо Минска.kml', 2048);
    await openTab();
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить маршрут' }));
    const field = await screen.findByDisplayValue('Кольцо Минска');
    await fireEvent.changeText(field, 'ab');
    await fireEvent.press(screen.getByRole('button', { name: 'Загрузить' }));
    expect(await screen.findByText('Слишком короткое — от 3 символов')).toBeOnTheScreen();
    expect(api.myRouteUploadRequest).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByDisplayValue('ab'), 'Кольцо');
    await fireEvent.press(screen.getByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    expect(api.myRouteUploadRequest).toHaveBeenCalledWith(TOKEN, 'Кольцо');
    await act(async () => FakeXhr.last?.progress(30, 100));
    expect(screen.getByText('Загружаем Кольцо Минска.kml: 30%')).toBeOnTheScreen();

    const created = mine({ title: 'Кольцо', status: 'processing', distanceM: null, isLoop: null });
    listMine.mockResolvedValue(page([created, ring]));
    await act(async () => FakeXhr.last?.respond(202, created));
    const links = await screen.findAllByRole('link');
    expect(links[0]).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Кольцо\. Обрабатывается/),
    );
  });

  it.each([
    [415, 'ROUTE_FORMAT_UNSUPPORTED', 'Формат не поддерживается — выберите GPX или KML'],
    [413, 'ROUTE_TOO_LARGE', 'Файл слишком большой — до 5 МБ'],
    [429, 'RATE_LIMITED', 'Слишком много загрузок. Попробуйте позже.'],
    [409, 'ROUTE_QUOTA_EXCEEDED', 'Можно хранить до 100 маршрутов — удалите ненужные'],
  ])('ответ %d %s — «%s»', async (status, code, message) => {
    picked('route.gpx', 1024);
    await openTab();
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить маршрут' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await act(async () => FakeXhr.last?.respond(status, { code, message: 'x' }));
    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it('«Отменить» во время отправки — запрос прерван, ошибки нет', async () => {
    picked('route.gpx', 1024);
    await openTab();
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить маршрут' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить' }));
    expect(FakeXhr.last?.aborted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Загрузить маршрут' })).toBeOnTheScreen();
  });
});

describe('карточка своего маршрута (AC3, M3)', () => {
  const openDetail = (id: string) =>
    renderRouter(routes, { initialUrl: `/routes/mine/${id}`, wrapper: createQueryWrapper() });

  it('гость по ссылке — гард ведёт на регистрацию, запроса нет', async () => {
    useSessionStore.setState({ status: 'signedOut', session: null });
    const router = await renderRouter(appRoutes, { initialUrl: `/routes/mine/${ring.id}` });
    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
    expect(getMine).not.toHaveBeenCalled();
  });

  it('невалидный id — «Маршрут недоступен» без запроса', async () => {
    await openDetail('not-a-uuid');
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(getMine).not.toHaveBeenCalled();
  });

  it('404 (чужой, удалён) — «Маршрут недоступен» и «Мои маршруты»', async () => {
    getMine.mockRejectedValue(http(404, 'NOT_FOUND'));
    const router = await openDetail(ring.id);
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Мои маршруты' }));
    await waitFor(() => expect(router.getPathname()).toBe('/routes'));
    expect(router.getSearchParams()).toMatchObject({ view: 'mine' });
  });

  it('готовый — карта без коридора, длина, набор, петля, «Загружен»; «Поделиться» нет', async () => {
    await openDetail(ring.id);
    expect(
      await screen.findByLabelText('Карта моего маршрута: 42 км, старт и финиш отмечены'),
    ).toBeOnTheScreen();
    await screen.findByTestId('maplibre-Map');
    expect(screen.getAllByTestId('maplibre-Layer').map((layer) => layer.props.id)).toEqual([
      'route',
      'start',
      'finish',
    ]);
    expect(getMineMap).toHaveBeenCalledWith(TOKEN, ring.id);
    expect(screen.getByText('Длина')).toBeOnTheScreen();
    expect(screen.getByText('Набор высоты')).toBeOnTheScreen();
    expect(screen.getByText('Да — старт и финиш в одном месте')).toBeOnTheScreen();
    expect(screen.getByText('Загружен')).toBeOnTheScreen();
    expect(screen.getByText('27 октября 2026')).toBeOnTheScreen();
    expect(screen.queryByText('Поделиться')).toBeNull();
  });

  it('routes-04c: карту двигает один палец нативно — прокрутка карточки не выключается (вне карты — страница)', async () => {
    await openDetail(ring.id);
    const map = await screen.findByTestId('maplibre-Map');
    const scroll = () => screen.getByTestId('my-route-detail');
    expect(map).toHaveProp('dragPan', true);
    expect(scroll().props.scrollEnabled).not.toBe(false);
    await fireEvent(map, 'regionIsChanging', {
      nativeEvent: { center: [27.6, 53.9], zoom: 12, bounds: [27.5, 53.8, 27.7, 54.0] },
    });
    expect(scroll().props.scrollEnabled).not.toBe(false);
  });

  it('обрабатывается — статус без карты; опрос до готовности', async () => {
    const pending = { ...ring, status: 'processing' as const, distanceM: null, isLoop: null };
    getMine.mockResolvedValue(pending);
    await openDetail(ring.id);
    expect(await screen.findByText('Обрабатывается')).toBeOnTheScreen();
    expect(screen.queryByText('Длина')).toBeNull();
    expect(getMineMap).not.toHaveBeenCalled();
    getMine.mockResolvedValue(ring);
    await act(() => jest.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText('Длина')).toBeOnTheScreen();
  });

  it('«Переименовать» — POST rename, новое название; 2 символа — ошибка под полем без запроса', async () => {
    renameMine.mockResolvedValue({ ...ring, title: 'Утренний круг' });
    await openDetail(ring.id);
    await fireEvent.press(await screen.findByRole('button', { name: 'Переименовать' }));
    await fireEvent.changeText(screen.getByDisplayValue('Вечерний круг'), 'ab');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Слишком короткое — от 3 символов')).toBeOnTheScreen();
    expect(renameMine).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByDisplayValue('ab'), ' Утренний круг ');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(renameMine).toHaveBeenCalledWith(TOKEN, ring.id, { title: 'Утренний круг' }),
    );
    expect(await screen.findByRole('header', { name: 'Утренний круг' })).toBeOnTheScreen();
    expect(screen.queryByDisplayValue(' Утренний круг ')).toBeNull();
  });

  it('«Удалить» — подтверждение → POST delete → «Мои маршруты»', async () => {
    deleteMine.mockResolvedValue(undefined);
    const router = await openDetail(ring.id);
    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить' }));
    expect(
      screen.getByText('Удалить маршрут насовсем? Линия и файл будут удалены.'),
    ).toBeOnTheScreen();
    expect(deleteMine).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(deleteMine).toHaveBeenCalledWith(TOKEN, ring.id));
    await waitFor(() => expect(router.getPathname()).toBe('/routes'));
    expect(router.getSearchParams()).toMatchObject({ view: 'mine' });
  });
});

describe('фиксы ревью pass 1', () => {
  const openDetail = (id: string) =>
    renderRouter(routes, { initialUrl: `/routes/mine/${id}`, wrapper: createQueryWrapper() });
  const mapLabel = 'Карта моего маршрута: 42 км, старт и финиш отмечены';
  const pullDetail = async () => {
    const control = screen.getByTestId('my-route-detail').props
      .refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      await control.props.onRefresh?.();
    });
  };

  it('ошибка геометрии — «Не удалось загрузить» с повтором; повтор показывает карту', async () => {
    getMineMap.mockRejectedValueOnce(http(500, 'INTERNAL'));
    await openDetail(ring.id);
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByText('Длина')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
  });

  it('ошибка геометрии (нет сети) — pull-to-refresh карточки перезапрашивает и карту', async () => {
    getMineMap.mockRejectedValueOnce(new ApiNetworkError(new TypeError('x')));
    await openDetail(ring.id);
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await pullDetail();
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    expect(getMineMap).toHaveBeenCalledTimes(2);
  });

  it('удалён на другом устройстве: обновление с 404 при показанных данных — «Маршрут недоступен», карты нет', async () => {
    await openDetail(ring.id);
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    getMine.mockRejectedValue(http(404, 'NOT_FOUND'));
    await pullDetail();
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(screen.queryByLabelText(mapLabel)).toBeNull();
    expect(screen.queryByText('Длина')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('удаление из карточки, открытой из ленты, — возврат к той же вкладке (один экземпляр вкладок в стеке)', async () => {
    deleteMine.mockResolvedValue(undefined);
    const router = await openTab();
    await fireEvent.press(await screen.findByRole('link', { name: ringLabel }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Удалить' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(router.getPathname()).toBe('/routes'));
    const root = router.getRouterState()?.routes[0]?.state;
    expect(root?.routes.map((route: { name: string }) => route.name)).toEqual(['(tabs)']);
  });

  it('открытие готовой карточки не перезапрашивает ленту', async () => {
    await openTab();
    await fireEvent.press(await screen.findByRole('link', { name: ringLabel }));
    expect(await screen.findByText('Длина')).toBeOnTheScreen();
    expect(listMine).toHaveBeenCalledTimes(1);
  });

  it('отправка не прерывается переключением на «Каталог» и обратно', async () => {
    picked('route.gpx', 1024);
    await openTab();
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить маршрут' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await act(async () => FakeXhr.last?.progress(40, 100));
    await fireEvent.press(screen.getByRole('tab', { name: 'Каталог' }));
    await fireEvent.press(await screen.findByRole('tab', { name: 'Мои' }));
    expect(await screen.findByText('Загружаем route.gpx: 40%')).toBeOnTheScreen();
    expect(FakeXhr.last?.aborted).toBe(false);
  });
});
