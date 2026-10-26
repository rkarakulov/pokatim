/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CatalogRouteDetail, RaceCard, RouteMapGeometry } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { api } from '@/lib/api';
import { shareLink, shareOrigin } from '@/lib/share-link';

import { appRoutes } from './app-routes';

jest.mock('@/lib/api');
jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn() }));
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getRoute = jest.mocked(api.getCatalogRoute);
const getMap = jest.mocked(api.getCatalogRouteMap);
const listRaces = jest.mocked(api.listCatalogRouteRaces);
const share = jest.mocked(shareLink);

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
const heroLabel = /Маршрут команды/;
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
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
  delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const open = (id = ID) => renderRouter(appRoutes, { initialUrl: `/routes/${id}` });

describe('карточка маршрута каталога: гость по ссылке (routes-01, AC6)', () => {
  it('поля: длина, набор, петля, город, покрытие; гостя не уводит', async () => {
    const router = await open();
    expect(await screen.findByLabelText(heroLabel)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/routes/${ID}`);
    expect(screen.getByText('Длина')).toBeOnTheScreen();
    expect(screen.getByText('Набор высоты')).toBeOnTheScreen();
    expect(screen.getByText('Да — старт и финиш в одном месте')).toBeOnTheScreen();
    expect(screen.getByText('Город старта')).toBeOnTheScreen();
    expect(screen.getByText('асфальт, гравий')).toBeOnTheScreen();
    expect(getRoute).toHaveBeenCalledWith(ID);
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
    expect(screen.getByText('Длина')).toBeOnTheScreen();
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
    expect(screen.queryByText('Гонки на маршруте')).toBeNull();
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
    expect(await screen.findByRole('header', { name: 'Гонки на маршруте' })).toBeOnTheScreen();
    expect(screen.getByText('Осенний коридор')).toBeOnTheScreen();
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
    expect(screen.queryByText('Гонки на маршруте')).toBeNull();
    expect(screen.getByText('Длина')).toBeOnTheScreen();
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
});
