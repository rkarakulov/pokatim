/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CatalogRouteDetail, RaceCard, RouteMapGeometry } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download-file';
import { shareLink, shareOrigin } from '@/lib/share-link';

import { MAP_PINCH_TEST_ID } from '@/features/maps/map-gestures';
import { PROFILE_PAN_TEST_ID } from '@/features/routes/profile-chart';

import { appRoutes } from './app-routes';

jest.mock('@/lib/api');
jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn() }));
jest.mock('@/lib/download-file', () => ({ downloadFile: jest.fn() }));
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getRoute = jest.mocked(api.getCatalogRoute);
const getMap = jest.mocked(api.getCatalogRouteMap);
const listRaces = jest.mocked(api.listCatalogRouteRaces);
const share = jest.mocked(shareLink);
const download = jest.mocked(downloadFile);
const gpxUrl = jest.mocked(api.catalogRouteGpxUrl);

const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000001';
const LIGHT = 'https://tiles.example/styles/positron';

const route: CatalogRouteDetail = {
  id: ID,
  title: 'Минское кольцо',
  distanceM: 86_012,
  elevationGainM: 1_240,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt', 'gravel'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  elevation: {
    minM: 191,
    maxM: 267,
    profile: [
      [0, 191],
      [43_000, 267],
      [86_012, 200],
    ],
  },
  gpxAvailable: true,
};
const geometry: RouteMapGeometry = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
};
let seq = 0;
const race = (overrides: Partial<RaceCard> = {}): RaceCard => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1) + 100).padStart(12, '0')}`,
  title: `Гонка ${seq}`,
  bikeClass: 'road',
  surfaces: ['asphalt'],
  distanceKm: 86,
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: null,
  ...overrides,
});
/** Ячейка «Дистанция» стат-блока — карточка показана. */
const heroLabel = /^Дистанция 86 км/;
const mapLabel = 'Карта маршрута: 86 км, старт и финиш отмечены';
const notFound = () => new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
  process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
  getRoute.mockResolvedValue(route);
  getMap.mockResolvedValue(geometry);
  listRaces.mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(shareOrigin).mockReturnValue('https://pokatim.by');
  share.mockResolvedValue('shared');
  download.mockResolvedValue(undefined);
  gpxUrl.mockImplementation((id) => `https://api.test/v1/routes/${id}/gpx`);
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
  delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const pullToRefresh = async () => {
  const control = screen.getByTestId('route-detail').props
    .refreshControl as ReactElement<RefreshControlProps>;
  await act(async () => {
    await control.props.onRefresh?.();
  });
};
// 4xx не повторяется (`shouldRetry`) — состояние ошибки сразу
const failure = () => new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x' });

const open = (id = ID) => renderRouter(appRoutes, { initialUrl: `/routes/${id}` });

describe('карточка маршрута каталога: гость по ссылке (routes-01, AC6)', () => {
  it('раскладка routes-03: без героя; название, чипы, стат-блок, профиль; гостя не уводит', async () => {
    const router = await open();
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/routes/${ID}`);
    // типографского героя (SectionHero) нет
    expect(screen.queryByText('Маршрут команды')).toBeNull();
    expect(
      within(screen.getByTestId('route-detail')).getByRole('header', { name: 'Минское кольцо' }),
    ).toBeOnTheScreen();
    for (const chip of ['Асфальт', 'Гравий', 'Круговой', 'Минск']) {
      expect(screen.getByText(chip)).toBeOnTheScreen();
    }
    expect(screen.getByLabelText('Дистанция 86 км круговой')).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Набор 1\s240 м макс\. 267 м$/)).toBeOnTheScreen();
    // асфальт + гравий — 24 км/ч: 86 км → 3 ч 35 мин
    expect(screen.getByLabelText('В пути 3 ч 35 мин при 24 км/ч')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Профиль высоты' })).toBeOnTheScreen();
    expect(
      screen.getByRole('adjustable', { name: /^Профиль высоты: от 191 до 267 м, набор 1\s240 м$/ }),
    ).toBeOnTheScreen();
    expect(getRoute).toHaveBeenCalledWith(ID);
  });

  it('скраббинг (routes-04): increment профиля — карточка «1 км · …», маркер на карте; стат-блок в три колонки', async () => {
    await open();
    const profile = await screen.findByRole('adjustable', { name: /^Профиль высоты/ });
    await screen.findByTestId('maplibre-Map');
    expect(screen.getByTestId('scrub-overlay')).toBeOnTheScreen();
    await fireEvent(profile, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(
      screen.getByText(/^1 км · \d+ м · [↗↘→] \d+ % · набор \d+ м$/, {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();
    expect(profile.props.accessibilityValue.text).toMatch(/^1 км, высота \d+ м, уклон −?\d+ %$/);
    for (const cell of screen.getAllByTestId('stat-block-cell')) {
      expect(cell).toHaveStyle({ flexBasis: 0, flexShrink: 1 });
    }
  });

  it('скраббинг: жест по профилю (dragging) выключает прокрутку экрана, конец жеста — включает; прокрутка скрывает курсор', async () => {
    await open();
    const profile = await screen.findByRole('adjustable', { name: /^Профиль высоты/ });
    const scroll = () => screen.getByTestId('route-detail');
    expect(scroll()).toHaveProp('scrollEnabled', true);
    await fireEvent(profile, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 340, height: 85 } },
    });
    const pan = createGestureController(PROFILE_PAN_TEST_ID);
    await act(async () => pan.begin({ x: 170 }));
    await act(async () => pan.activate({ x: 170 }));
    expect(scroll()).toHaveProp('scrollEnabled', false);
    await act(async () => pan.update({ x: 85 }));
    await act(async () => pan.end({ x: 85 }));
    expect(scroll()).toHaveProp('scrollEnabled', true);
    expect(
      screen.getByTestId('elevation-profile-cursor', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    await fireEvent(scroll(), 'scrollBeginDrag');
    expect(
      screen.queryByTestId('elevation-profile-cursor', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('routes-04b (RC-3): щипок карты выключает прокрутку экрана вместе со скраббингом (оба условия)', async () => {
    await open();
    const profile = await screen.findByRole('adjustable', { name: /^Профиль высоты/ });
    await screen.findByTestId('maplibre-Map');
    const scroll = () => screen.getByTestId('route-detail');
    await fireEvent(profile, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 340, height: 85 } },
    });
    const pinch = createGestureController(MAP_PINCH_TEST_ID);
    const pan = createGestureController(PROFILE_PAN_TEST_ID);
    await act(async () => pinch.begin({ focalX: 100, focalY: 80, scale: 1 }));
    await act(async () => pinch.activate({ focalX: 100, focalY: 80, scale: 1.2 }));
    expect(scroll()).toHaveProp('scrollEnabled', false);
    // скраббинг начался и закончился во время щипка — прокрутка всё ещё выключена картой
    await act(async () => pan.begin({ x: 170 }));
    await act(async () => pan.activate({ x: 170 }));
    await act(async () => pan.end({ x: 170 }));
    expect(scroll()).toHaveProp('scrollEnabled', false);
    await act(async () => pinch.end({ focalX: 100, focalY: 80, scale: 1.2 }));
    expect(scroll()).toHaveProp('scrollEnabled', true);
  });

  it('API до routes-03 (без elevation и gpxAvailable): без профиля и без «Скачать GPX», набор без «макс.»', async () => {
    getRoute.mockResolvedValue({ ...route, elevation: null, gpxAvailable: false });
    await open();
    await screen.findByLabelText(heroLabel);
    expect(screen.queryByTestId('elevation-profile')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Скачать GPX' })).toBeNull();
    expect(screen.getByLabelText(/^Набор 1\s240 м$/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
  });

  it('«Поделиться» — primary, «Скачать GPX» — secondary; нажатие — downloadFile(адрес API)', async () => {
    await open();
    const gpx = await screen.findByRole('button', { name: 'Скачать GPX' });
    // primary — заливка, secondary — прозрачная кнопка с рамкой (Button UI-кита)
    expect(screen.getByRole('button', { name: 'Поделиться' })).not.toHaveStyle({
      backgroundColor: 'transparent',
    });
    expect(gpx).toHaveStyle({ backgroundColor: 'transparent' });
    await fireEvent.press(gpx);
    expect(gpxUrl).toHaveBeenCalledWith(ID);
    expect(download).toHaveBeenCalledWith(`https://api.test/v1/routes/${ID}/gpx`);
    expect(screen.queryByText('Не удалось открыть файл GPX.')).toBeNull();
  });

  it('«Скачать GPX»: отказ (нет браузера) — баннер под кнопкой', async () => {
    download.mockRejectedValue(new Error('no browser'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Скачать GPX' }));
    expect(await screen.findByText('Не удалось открыть файл GPX.')).toBeOnTheScreen();
  });

  it('первая загрузка — скелетон той же раскладки (карта, название, стат-блок, профиль)', async () => {
    getRoute.mockReturnValue(new Promise(() => undefined));
    await open();
    expect(
      await screen.findByTestId('route-detail-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it('карта без коридора: RouteMap с линией, стартом и финишем; подпись без координат', async () => {
    await open();
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    expect(mapLabel).not.toMatch(/\d+\.\d+/);
    await screen.findByTestId('maplibre-Map');
    expect(screen.getAllByTestId('maplibre-Layer').map((layer) => layer.props.id)).toEqual([
      'route',
      'start',
      'finish',
    ]);
    expect(getMap).toHaveBeenCalledWith(ID);
  });

  it('env стиля не задан — карты нет и запроса геометрии нет; цифры на месте', async () => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
    await open();
    await screen.findByLabelText(heroLabel);
    await waitFor(() => expect(screen.queryByTestId('catalog-route-map-skeleton')).toBeNull());
    expect(screen.queryByLabelText(mapLabel)).toBeNull();
    expect(getMap).not.toHaveBeenCalled();
    expect(screen.getByTestId('stat-block')).toBeOnTheScreen();
  });

  it('404 — «Маршрут недоступен»; невалидный id — то же без запроса', async () => {
    getRoute.mockRejectedValue(notFound());
    await open();
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Все маршруты' })).toBeOnTheScreen();
    getRoute.mockClear();
    await open('not-a-uuid');
    expect(await screen.findByText('Маршрут недоступен')).toBeOnTheScreen();
    expect(getRoute).not.toHaveBeenCalled();
  });

  it('гонок нет — блока нет', async () => {
    await open();
    await screen.findByLabelText(heroLabel);
    await waitFor(() => expect(listRaces).toHaveBeenCalledWith(ID, { limit: 10 }));
    // пока грузится — заголовок и скелетон; подтверждённо пусто — блока нет
    await waitFor(() => expect(screen.queryByText('Гонки на маршруте')).toBeNull());
  });

  it('гонки на маршруте: карточки-ссылки, «Показать ещё» догружает по курсору', async () => {
    const first = race({ title: 'Осенний коридор' });
    const second = race({ title: 'Весенний коридор' });
    listRaces.mockImplementation((_id, params = {}) =>
      Promise.resolve(
        params.cursor
          ? { items: [second], nextCursor: null }
          : { items: [first], nextCursor: 'c2' },
      ),
    );
    const router = await open();
    expect(await screen.findByText('Осенний коридор')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Гонки на маршруте' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Показать ещё'));
    expect(await screen.findByText('Весенний коридор')).toBeOnTheScreen();
    expect(listRaces).toHaveBeenLastCalledWith(ID, { limit: 10, cursor: 'c2' });
    expect(screen.queryByText('Показать ещё')).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: /^Осенний коридор/ }));
    expect(router.getPathname()).toBe(`/races/${first.id}`);
  });

  it('ошибка гонок — блока нет, карточка цела', async () => {
    listRaces.mockRejectedValue(notFound());
    await open();
    await screen.findByLabelText(heroLabel);
    await waitFor(() => expect(listRaces).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Гонки на маршруте')).toBeNull());
    expect(screen.getByTestId('stat-block')).toBeOnTheScreen();
  });

  it('«Поделиться» — ссылка /routes/<id> с описанием без ПДн; нет origin — кнопки нет', async () => {
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(share).toHaveBeenCalledWith({
      title: 'Минское кольцо',
      text: expect.stringContaining('86 км'),
      path: `/routes/${ID}`,
    });
    await act(async () => undefined);

    jest.mocked(shareOrigin).mockReturnValue(null);
    await open();
    await screen.findByLabelText(heroLabel);
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
  });

  it('гонки маршрута грузятся — заголовок блока и скелетон карточек', async () => {
    listRaces.mockReturnValue(new Promise(() => undefined));
    await open();
    await screen.findByLabelText(heroLabel);
    expect(await screen.findByRole('header', { name: 'Гонки на маршруте' })).toBeOnTheScreen();
    expect(screen.getByTestId('route-races-skeleton')).toBeOnTheScreen();
  });

  it('ошибка обновления гонок — карточки остаются, баннер с повтором', async () => {
    listRaces.mockResolvedValue({ items: [race({ title: 'Осенний коридор' })], nextCursor: null });
    await open();
    expect(await screen.findByText('Осенний коридор')).toBeOnTheScreen();
    listRaces.mockRejectedValue(failure());
    await pullToRefresh();
    expect(await screen.findByText('Данные могли устареть')).toBeOnTheScreen();
    expect(screen.getByText('Осенний коридор')).toBeOnTheScreen();
    listRaces.mockResolvedValue({
      items: [race({ title: 'Обновлённая гонка' })],
      nextCursor: null,
    });
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByText('Обновлённая гонка')).toBeOnTheScreen();
    expect(screen.queryByText('Данные могли устареть')).toBeNull();
  });

  it('ошибка следующей страницы — баннер в подвале блока с повтором, загруженное остаётся', async () => {
    const first = race({ title: 'Осенний коридор' });
    listRaces.mockImplementation((_id, params = {}) =>
      params.cursor
        ? Promise.reject(failure())
        : Promise.resolve({ items: [first], nextCursor: 'c2' }),
    );
    await open();
    await fireEvent.press(await screen.findByText('Показать ещё'));
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByText('Осенний коридор')).toBeOnTheScreen();
    listRaces.mockImplementation((_id, params = {}) =>
      Promise.resolve(
        params.cursor
          ? { items: [race({ title: 'Весенний коридор' })], nextCursor: null }
          : { items: [first], nextCursor: 'c2' },
      ),
    );
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByText('Весенний коридор')).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });
});
