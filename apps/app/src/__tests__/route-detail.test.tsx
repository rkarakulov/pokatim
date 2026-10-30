/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CatalogRouteDetail, RaceCard, RouteMapGeometry } from '@pokatim/contracts';
import { appThemes } from '@pokatim/design-tokens';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download-file';
import { prepareShareImage } from '@/lib/share-image';
import { shareLink, shareOrigin } from '@/lib/share-link';

import { PROFILE_PAN_TEST_ID } from '@/features/routes/profile-chart';

import { appRoutes, tabRoutes } from './app-routes';
import { liveSession, storeSession, storeSurveyCompleted } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';
import { ridesPage } from './route-rides-fixtures';
import CatalogRouteRoute from '../app/routes/[id]';

jest.mock('@/lib/api');
jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn() }));
jest.mock('@/lib/share-image', () => ({
  shareImageSupported: () => true,
  prepareShareImage: jest.fn(),
}));
jest.mock('@/lib/download-file', () => ({ downloadFile: jest.fn() }));

const getRoute = jest.mocked(api.getCatalogRoute);
const getMap = jest.mocked(api.getCatalogRouteMap);
const listRaces = jest.mocked(api.listCatalogRouteRaces);
const share = jest.mocked(shareLink);
const download = jest.mocked(downloadFile);
const exportUrl = jest.mocked(api.catalogRouteExportUrl);

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
  author: { kind: 'team' },
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
  // ответ до routes-formats (без поля) — дефолт контракта; форматы — по gpxAvailable (RC-9)
  exportFormats: [],
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
  // route-rides-02 (RC-12): «Мои заезды» вошедшего — по умолчанию пусто (автомок вернул бы undefined)
  jest.mocked(api.listRouteRides).mockResolvedValue(ridesPage());
  listRaces.mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(shareOrigin).mockReturnValue('https://pokatim.by');
  share.mockResolvedValue('shared');
  download.mockResolvedValue(undefined);
  exportUrl.mockImplementation((id, format) => `https://api.test/v1/routes/${id}/${format}`);
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
const layoutOf = (height: number) => ({
  nativeEvent: { layout: { x: 0, y: 0, width: 375, height } },
});
/** routes-04d (RC-5): карта монтируется после измерения шторки и области карты. */
const showMap = async () => {
  await fireEvent(await screen.findByTestId('bottom-sheet'), 'layout', layoutOf(420));
  await fireEvent(await screen.findByTestId('map-area'), 'layout', layoutOf(700));
  return screen.findByTestId('maplibre-Map');
};

describe('карточка маршрута каталога: гость по ссылке (routes-01, AC6)', () => {
  it('раскладка routes-04d: название — только в шапке; в шторке — строка цифр, чипы, профиль без заголовка; гостя не уводит', async () => {
    const router = await open();
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/routes/${ID}`);
    // типографского героя (SectionHero) нет
    expect(screen.queryByText('Маршрут команды')).toBeNull();
    // название под картой не дублируется — только шапка экрана
    expect(within(screen.getByTestId('bottom-sheet')).queryByText('Минское кольцо')).toBeNull();
    expect(screen.getAllByText('Минское кольцо')).toHaveLength(1);
    // строка цифр — в шапке шторки, чипы, профиль и кнопки — в теле
    expect(
      within(screen.getByTestId('bottom-sheet-header')).getByTestId('stat-block'),
    ).toBeOnTheScreen();
    const body = within(screen.getByTestId('route-detail'));
    expect(body.getByTestId('route-chips')).toBeOnTheScreen();
    expect(body.getByTestId('elevation-profile')).toBeOnTheScreen();
    expect(body.getByTestId('route-actions')).toBeOnTheScreen();
    for (const chip of ['Асфальт', 'Гравий', 'Круговой', 'Минск']) {
      expect(screen.getByText(chip)).toBeOnTheScreen();
    }
    expect(screen.getByLabelText('Дистанция 86 км круговой')).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Набор 1\s240 м макс\. 267 м$/)).toBeOnTheScreen();
    // асфальт + гравий — 24 км/ч: 86 км → 3 ч 35 мин
    expect(screen.getByLabelText('В пути 3 ч 35 мин при 24 км/ч')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Профиль высоты' })).toBeNull();
    expect(
      screen.getByRole('adjustable', { name: /^Профиль высоты: от 191 до 267 м, набор 1\s240 м$/ }),
    ).toBeOnTheScreen();
    expect(getRoute).toHaveBeenCalledWith(ID);
  });

  it('скраббинг (routes-04): increment профиля — карточка «1 км · …», маркер на карте; стат-блок в три колонки', async () => {
    await open();
    const profile = await screen.findByRole('adjustable', { name: /^Профиль высоты/ });
    await showMap();
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

  it('скраббинг: жест по профилю (dragging) выключает прокрутку тела шторки, конец жеста — включает; прокрутка скрывает курсор', async () => {
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

  it('routes-04c/04d: карта вне шторки двигается одним пальцем нативно — прокрутку тела шторки выключает только скраббинг', async () => {
    await open();
    const profile = await screen.findByRole('adjustable', { name: /^Профиль высоты/ });
    const map = await showMap();
    // карта — не внутри прокрутки (шторка — сосед поверх)
    expect(within(screen.getByTestId('route-detail')).queryByTestId('maplibre-Map')).toBeNull();
    const scroll = () => screen.getByTestId('route-detail');
    expect(map).toHaveProp('dragPan', true);
    // нативный жест карты двигает камеру — прокрутка экрана остаётся
    await fireEvent(map, 'regionIsChanging', {
      nativeEvent: { center: [27.6, 53.9], zoom: 12, bounds: [27.5, 53.8, 27.7, 54.0] },
    });
    expect(scroll()).toHaveProp('scrollEnabled', true);
    await fireEvent(profile, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 340, height: 85 } },
    });
    const pan = createGestureController(PROFILE_PAN_TEST_ID);
    await act(async () => pan.begin({ x: 170 }));
    await act(async () => pan.activate({ x: 170 }));
    expect(scroll()).toHaveProp('scrollEnabled', false);
    await act(async () => pan.end({ x: 170 }));
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

  it('«Поделиться» — primary, «Скачать GPX» — secondary, в одну строку; нажатие — downloadFile(адрес API)', async () => {
    await open();
    const gpx = await screen.findByRole('button', { name: 'Скачать GPX' });
    const row = screen.getByTestId('route-actions');
    expect(row).toHaveStyle({ flexDirection: 'row' });
    expect(within(row).getByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
    expect(within(row).getByRole('button', { name: 'Скачать GPX' })).toBeOnTheScreen();
    // primary — заливка, secondary — прозрачная кнопка с рамкой (Button UI-кита)
    expect(screen.getByRole('button', { name: 'Поделиться' })).not.toHaveStyle({
      backgroundColor: 'transparent',
    });
    expect(gpx).toHaveStyle({ backgroundColor: 'transparent' });
    await fireEvent.press(gpx);
    expect(exportUrl).toHaveBeenCalledWith(ID, 'gpx');
    expect(download).toHaveBeenCalledWith(`https://api.test/v1/routes/${ID}/gpx`);
    expect(screen.queryByText('Не удалось открыть файл GPX.')).toBeNull();
    // один формат — без шита выбора
    expect(screen.queryByTestId('route-download-sheet')).toBeNull();
  });

  it('«Скачать GPX»: отказ (нет браузера) — баннер под кнопкой', async () => {
    download.mockRejectedValue(new Error('no browser'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Скачать GPX' }));
    expect(await screen.findByText('Не удалось открыть файл GPX.')).toBeOnTheScreen();
  });

  it('exportFormats: [gpx] (маршрут до бэкфилла) — прежняя «Скачать GPX» без шита', async () => {
    getRoute.mockResolvedValue({ ...route, exportFormats: ['gpx'] });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Скачать GPX' }));
    expect(download).toHaveBeenCalledWith(`https://api.test/v1/routes/${ID}/gpx`);
    expect(screen.queryByRole('button', { name: 'Скачать' })).toBeNull();
    expect(screen.queryByTestId('route-download-sheet')).toBeNull();
  });

  it('три формата (routes-formats): «Скачать» в строке с «Поделиться» → шит → формат: downloadFile(адрес формата) синхронно, шит закрыт', async () => {
    getRoute.mockResolvedValue({ ...route, exportFormats: ['gpx', 'kml', 'tcx'] });
    await open();
    const row = await screen.findByTestId('route-actions');
    const button = await within(row).findByRole('button', { name: 'Скачать' });
    expect(within(row).getByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Скачать GPX' })).toBeNull();
    expect(button).toHaveStyle({ backgroundColor: 'transparent' });

    await fireEvent.press(button);
    const sheet = await screen.findByTestId('route-download-sheet');
    expect(within(sheet).getByRole('heading', { name: 'Скачать маршрут' })).toBeOnTheScreen();
    for (const name of ['GPX', 'KML', 'TCX']) {
      expect(within(sheet).getByRole('button', { name })).toBeOnTheScreen();
    }
    expect(within(sheet).getByText('Google Earth и Google Мои карты')).toBeOnTheScreen();
    // подпись формата связана с кнопкой: группа «формат: для чего» (у Button UI-кита нет accessibilityHint)
    const option = within(sheet).getByTestId('route-download-option-kml');
    expect(option.props.role).toBe('group');
    expect(option.props['aria-label']).toBe('KML: Google Earth и Google Мои карты');
    expect(within(option).getByRole('button', { name: 'KML' })).toBeOnTheScreen();
    expect(download).not.toHaveBeenCalled();

    // нажатие формата: downloadFile вызван в том же обработчике (до await), шит закрыт
    const pressed = fireEvent.press(within(sheet).getByRole('button', { name: 'KML' }));
    expect(download).toHaveBeenCalledWith(`https://api.test/v1/routes/${ID}/kml`);
    await pressed;
    expect(exportUrl).toHaveBeenCalledWith(ID, 'kml');
    await waitFor(() => expect(screen.queryByTestId('route-download-sheet')).toBeNull());

    await fireEvent.press(screen.getByRole('button', { name: 'Скачать' }));
    await fireEvent.press(
      within(await screen.findByTestId('route-download-sheet')).getByRole('button', {
        name: 'TCX',
      }),
    );
    expect(download).toHaveBeenLastCalledWith(`https://api.test/v1/routes/${ID}/tcx`);
  });

  it('шит: «Закрыть» — без скачивания; отказ скачивания — баннер с форматом', async () => {
    getRoute.mockResolvedValue({ ...route, exportFormats: ['gpx', 'kml', 'tcx'] });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Скачать' }));
    await fireEvent.press(
      within(await screen.findByTestId('route-download-sheet')).getByRole('button', {
        name: 'Закрыть',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('route-download-sheet')).toBeNull());
    expect(download).not.toHaveBeenCalled();

    download.mockRejectedValue(new Error('no browser'));
    await fireEvent.press(screen.getByRole('button', { name: 'Скачать' }));
    await fireEvent.press(
      within(await screen.findByTestId('route-download-sheet')).getByRole('button', {
        name: 'TCX',
      }),
    );
    expect(await screen.findByText('Не удалось открыть файл TCX.')).toBeOnTheScreen();
  });

  it('exportFormats пусто и gpxAvailable: false — кнопки скачивания нет', async () => {
    getRoute.mockResolvedValue({ ...route, gpxAvailable: false, exportFormats: [] });
    await open();
    await screen.findByLabelText(heroLabel);
    expect(screen.queryByRole('button', { name: 'Скачать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Скачать GPX' })).toBeNull();
  });

  it('первая загрузка — скелетон той же раскладки (место карты, шторка-скелетон)', async () => {
    getRoute.mockReturnValue(new Promise(() => undefined));
    await open();
    expect(
      await screen.findByTestId('route-detail-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it('карта без коридора: RouteMap с линией, стартом и финишем; подпись без координат', async () => {
    await open();
    await showMap();
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    expect(mapLabel).not.toMatch(/\d+\.\d+/);
    // карта на всю область под шапкой; камера — с отступом шторки (RC-5)
    expect(screen.getByTestId('route-map')).toHaveStyle({ flex: 1 });
    expect(
      screen.getByTestId('maplibre-Camera').props.initialViewState.padding.bottom,
    ).toBeGreaterThan(420);
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
    // routes-04d (RC-8): область под шторкой — ровный фон, не пустота
    expect(screen.getByTestId('route-line-map-empty')).toBeOnTheScreen();
  });

  it('шторка: «чёрточка» сворачивает — видна только строка цифр; разворачивает обратно', async () => {
    await open();
    await screen.findByLabelText(heroLabel);
    await fireEvent.press(screen.getByRole('button', { name: 'Свернуть панель' }));
    expect(screen.getByRole('button', { name: 'Развернуть панель' })).toHaveProp(
      'accessibilityState',
      { expanded: false },
    );
    expect(screen.getByLabelText(heroLabel)).toBeOnTheScreen();
    expect(screen.queryByTestId('route-chips')).toBeNull();
    expect(screen.queryByRole('adjustable', { name: /^Профиль высоты/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Развернуть панель' }));
    expect(screen.getByTestId('route-chips')).toBeOnTheScreen();
  });

  it('до измерения шторки — место карты, карта не монтируется (RC-5)', async () => {
    await open();
    await screen.findByLabelText(heroLabel);
    expect(screen.queryByTestId('maplibre-Map')).toBeNull();
    expect(screen.getByTestId('catalog-route-map-skeleton')).toBeOnTheScreen();
  });

  it('без сети при показанных данных — баннер «Нет соединения» под шапкой, вне шторки', async () => {
    await open();
    await screen.findByLabelText(heroLabel);
    await act(async () => onlineManager.setOnline(false));
    const banner = await screen.findByText('Нет соединения');
    expect(within(screen.getByTestId('bottom-sheet')).queryByText('Нет соединения')).toBeNull();
    expect(banner).toBeOnTheScreen();
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

  it('«Поделиться» с OG-картинкой файлом: версия от API, PNG готовится заранее', async () => {
    const VERSION = '0123456789abcdef';
    jest.mocked(api.getOgCard).mockResolvedValue({ version: VERSION });
    jest
      .mocked(api.ogImageUrl)
      .mockImplementation(
        (kind, id, version) => `https://api.test/og/${kind}/${id}/${version}.png`,
      );
    const image = { uri: 'file:///cache/og.png' };
    jest.mocked(prepareShareImage).mockResolvedValue(image);
    await open();
    await waitFor(() =>
      expect(prepareShareImage).toHaveBeenCalledWith(
        `https://api.test/og/route/${ID}/${VERSION}.png`,
      ),
    );
    expect(api.getOgCard).toHaveBeenCalledWith('route', ID);
    await act(async () => undefined);
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ path: `/routes/${ID}`, image }));
  });

  it('картинка не загрузилась — «Поделиться» без картинки (ссылка), без ошибки на экране', async () => {
    jest.mocked(api.getOgCard).mockRejectedValue(notFound());
    await open();
    await waitFor(() => expect(api.getOgCard).toHaveBeenCalled());
    await act(async () => undefined);
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ image: undefined }));
    expect(prepareShareImage).not.toHaveBeenCalled();
    expect(screen.queryByText(/Не удалось поделиться/)).toBeNull();
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

describe('маршрут райдера на карточке каталога (routes-06)', () => {
  const getViewer = jest.mocked(api.getCatalogRouteViewer);
  const riderRoute: CatalogRouteDetail = { ...route, author: { kind: 'rider', name: 'Аня К.' } };
  const signedInRoutes = {
    ...tabRoutes,
    'routes/[id]': CatalogRouteRoute,
    'routes/report/[id]': () => null,
  };
  const openSignedIn = () =>
    renderRouter(signedInRoutes, { initialUrl: `/routes/${ID}`, wrapper: createQueryWrapper() });
  const signIn = () => {
    useSessionStore.setState({ status: 'signedIn', session: liveSession });
    useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
    jest.mocked(api.listCatalogRoutes).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(api.listCatalogRouteCities).mockResolvedValue({ cities: [] });
  };

  beforeEach(() => {
    getRoute.mockResolvedValue(riderRoute);
    getViewer.mockResolvedValue({ canReport: true, reported: false });
  });

  it('гость: бейдж «От райдера · имя»; «Гонки на маршруте» не запрашиваются (RC-1); без «Пожаловаться» и без me', async () => {
    await open();
    expect(await screen.findByText('От райдера · Аня К.')).toBeOnTheScreen();
    expect(screen.getByTestId('route-actions')).toBeOnTheScreen();
    expect(listRaces).not.toHaveBeenCalled();
    expect(getViewer).not.toHaveBeenCalled();
    expect(screen.queryByText('Пожаловаться')).toBeNull();
  });

  it('маршрут команды — без бейджа автора; гонки запрашиваются, me — нет (и вошедшему)', async () => {
    signIn();
    getRoute.mockResolvedValue(route);
    await openSignedIn();
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    await waitFor(() => expect(listRaces).toHaveBeenCalledWith(ID, { limit: 10 }));
    expect(screen.queryByText(/^От райдера/)).toBeNull();
    expect(getViewer).not.toHaveBeenCalled();
    expect(screen.queryByText('Пожаловаться')).toBeNull();
  });

  describe('вошедший', () => {
    beforeEach(signIn);

    it('canReport — «Пожаловаться» ведёт на экран жалобы; гонки не запрашиваются', async () => {
      const router = await openSignedIn();
      await fireEvent.press(await screen.findByText('Пожаловаться'));
      expect(getViewer).toHaveBeenCalledWith(liveSession.accessToken, ID);
      expect(router.getPathname()).toBe(`/routes/report/${ID}`);
      expect(listRaces).not.toHaveBeenCalled();
    });

    it('уже пожаловался — «Вы пожаловались на этот маршрут» вместо действия', async () => {
      getViewer.mockResolvedValue({ canReport: false, reported: true });
      await openSignedIn();
      expect(await screen.findByText('Вы пожаловались на этот маршрут')).toBeOnTheScreen();
      expect(screen.queryByText('Пожаловаться')).toBeNull();
    });

    it('свой маршрут (canReport false) — без «Пожаловаться»', async () => {
      getViewer.mockResolvedValue({ canReport: false, reported: false });
      await openSignedIn();
      expect(await screen.findByText('От райдера · Аня К.')).toBeOnTheScreen();
      await waitFor(() => expect(getViewer).toHaveBeenCalled());
      expect(screen.queryByText('Пожаловаться')).toBeNull();
      expect(screen.queryByText('Вы пожаловались на этот маршрут')).toBeNull();
    });

    it('первая загрузка права жалобы — скелетон блока', async () => {
      getViewer.mockReturnValue(new Promise(() => {}));
      await openSignedIn();
      expect(await screen.findByText('От райдера · Аня К.')).toBeOnTheScreen();
      expect(
        screen.getByTestId('route-report-skeleton', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
      expect(screen.queryByText('Пожаловаться')).toBeNull();
    });

    it('ошибка без данных — «Не удалось загрузить» с «Повторить»; повтор возвращает «Пожаловаться»', async () => {
      getViewer.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
      await openSignedIn();
      expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
      expect(screen.queryByText('Пожаловаться')).toBeNull();
      await fireEvent.press(screen.getByText('Повторить'));
      expect(await screen.findByText('Пожаловаться')).toBeOnTheScreen();
      expect(screen.queryByText('Не удалось загрузить')).toBeNull();
    });

    it('ошибка обновления — «Пожаловаться» остаётся, баннер «Данные могли устареть»', async () => {
      await openSignedIn();
      expect(await screen.findByText('Пожаловаться')).toBeOnTheScreen();
      getViewer.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
      await pullToRefresh();
      expect(await screen.findByText('Данные могли устареть')).toBeOnTheScreen();
      expect(screen.getByText('Пожаловаться')).toBeOnTheScreen();
    });
  });
});

/**
 * Личная тема райдера (user-theme): вошедший с пройденным онбордингом, тема — из профиля. Не переносить в следующие
 * тесты (clearAllMocks реализацию не сбрасывает).
 */
function themedRider(themeId: 'chrono' | 'typography') {
  storeSession(liveSession);
  storeSurveyCompleted();
  jest.mocked(api.getProfile).mockResolvedValue({
    rideReasons: [],
    publicName: null,
    showNameInResults: false,
    club: null,
    avatar: null,
    publicId: null,
    themeId,
  });
  jest.mocked(api.getCatalogRouteViewer).mockResolvedValue({ canReport: true, reported: false });
}

describe('карточка маршрута: шапка шторки по теме (app-themes C2)', () => {
  afterEach(() => jest.mocked(api.getProfile).mockReset());

  const themed = themedRider;

  it('Хронометр — плитки цифр в шапке шторки', async () => {
    themed('chrono');
    await open();
    await screen.findByLabelText(heroLabel);
    const header = within(screen.getByTestId('bottom-sheet-header'));
    const tile = appThemes.chrono.schemes.dark.surface.default;
    await waitFor(() =>
      expect(header.getAllByTestId('stat-block-cell')[0]).toHaveStyle({ backgroundColor: tile }),
    );
    expect(header.getAllByTestId('stat-block-cell')).toHaveLength(3);
    expect(header.queryByTestId('stat-block-numeral')).toBeNull();
  });

  it('Типографика — дистанция крупной цифрой', async () => {
    themed('typography');
    await open();
    await screen.findByLabelText(heroLabel);
    const header = within(screen.getByTestId('bottom-sheet-header'));
    expect(await header.findByTestId('stat-block-numeral')).toHaveTextContent('86км');
  });
});

describe('карточка маршрута: скелетон шапки по теме (app-themes C, ревью pass 1)', () => {
  afterEach(() => jest.mocked(api.getProfile).mockReset());

  const hidden = { includeHiddenElements: true };

  it.each([
    ['chrono', 'stat-skeleton-tiles'],
    ['typography', 'stat-skeleton-numeral'],
  ] as const)('%s — первая загрузка: скелетон шапки варианта', async (themeId, testID) => {
    themedRider(themeId);
    getRoute.mockReturnValue(new Promise(() => undefined));
    await open();
    const skeleton = within(await screen.findByTestId('route-detail-skeleton', hidden));
    expect(await skeleton.findByTestId(testID, hidden)).toBeOnTheScreen();
  });

  it('«Классика» — прежний скелетон строки цифр', async () => {
    getRoute.mockReturnValue(new Promise(() => undefined));
    await open();
    const skeleton = within(await screen.findByTestId('route-detail-skeleton', hidden));
    expect(skeleton.getByTestId('stat-skeleton-compact', hidden)).toBeOnTheScreen();
  });
});
