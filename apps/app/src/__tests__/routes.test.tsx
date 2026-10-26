/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CatalogRouteCard, CatalogRoutePage } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { Text, type RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const listRoutes = jest.mocked(api.listCatalogRoutes);
const listCities = jest.mocked(api.listCatalogRouteCities);

let seq = 0;
const route = (overrides: Partial<CatalogRouteCard> = {}): CatalogRouteCard => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`,
  title: `Маршрут ${seq}`,
  distanceM: 86_012,
  elevationGainM: 412,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  ...overrides,
});
const page = (items: CatalogRouteCard[], nextCursor: string | null = null): CatalogRoutePage => ({
  items,
  nextCursor,
});
const never = () => new Promise<never>(() => undefined);
const failure = () => new ApiHttpError(500, { code: 'INTERNAL', message: 'x' });

const ring = route({ title: 'Минское кольцо', surfaces: ['asphalt', 'gravel'] });
const brest = route({ title: 'Брестская сотка', city: 'brest', distanceM: 101_000, isLoop: false });
const ringLabel = 'Минское кольцо. 86 км · набор 412 м · петля · Минск · асфальт, гравий';

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  listRoutes.mockResolvedValue(page([ring, brest]));
  listCities.mockResolvedValue({ cities: ['minsk', 'brest'] });
});
afterEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

const routes = { ...tabRoutes, 'routes/[id]': () => <Text>Карточка маршрута</Text> };
const openRoutes = () =>
  renderRouter(routes, { initialUrl: '/routes', wrapper: createQueryWrapper() });
const feed = () => screen.getByTestId('routes-feed');
const refresh = async () => {
  const control = feed().props.refreshControl as ReactElement<RefreshControlProps>;
  await act(async () => {
    await control.props.onRefresh?.();
  });
};

describe('вкладка «Маршруты» (routes-01, AC5)', () => {
  it('загрузка: заголовок и чипы сразу, «Город» — скелетон группы, на месте данных — скелетон', async () => {
    listRoutes.mockReturnValue(never());
    listCities.mockReturnValue(never());
    await openRoutes();
    expect(screen.getByRole('header', { name: 'Маршруты' })).toBeOnTheScreen();
    for (const chip of ['до 50 км', '50–100 км', 'больше 100 км', 'Асфальт', 'Гравий']) {
      expect(screen.getByRole('button', { name: chip })).toBeOnTheScreen();
    }
    expect(screen.getByText('Город')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
  });

  it('карточки: название, цифры, место; чипы города — из API по алфавиту; нажатие ведёт в /routes/<id>', async () => {
    const router = await openRoutes();
    const link = await screen.findByRole('link', { name: ringLabel });
    expect(screen.getByText('101 км · набор 412 м')).toBeOnTheScreen();
    expect(screen.getByText('Брест · асфальт')).toBeOnTheScreen();
    const cityChips = screen.getAllByText(/^(Брест|Минск)$/).map((node) => node.props.children);
    expect(cityChips).toEqual(['Брест', 'Минск']);
    expect(listRoutes).toHaveBeenCalledWith({ city: [], distance: [], surface: [], limit: 20 });
    await fireEvent.press(link);
    expect(router.getPathname()).toBe(`/routes/${ring.id}`);
  });

  it('фильтры меняют ключ запроса (скелетон на месте данных); «Сбросить фильтры» снимает все', async () => {
    await openRoutes();
    await screen.findByRole('link', { name: ringLabel });
    listRoutes.mockClear();
    listRoutes.mockReturnValue(never());

    await fireEvent.press(screen.getByRole('button', { name: 'Минск' }));
    await fireEvent.press(screen.getByRole('button', { name: 'больше 100 км' }));
    await fireEvent.press(screen.getByRole('button', { name: 'до 50 км' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Гравий' }));
    expect(listRoutes).toHaveBeenLastCalledWith({
      city: ['minsk'],
      distance: ['gt100', 'lt50'],
      surface: ['gravel'],
      limit: 20,
    });
    expect(screen.queryByRole('link', { name: ringLabel })).toBeNull();
    expect(screen.getAllByLabelText('Загрузка').length).toBeGreaterThanOrEqual(1);

    listRoutes.mockResolvedValue(page([ring]));
    await fireEvent.press(screen.getByText('Сбросить фильтры'));
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Минск' })).not.toBeSelected();
  });

  it('пусто без фильтров — «Маршрутов пока нет»', async () => {
    listRoutes.mockResolvedValue(page([]));
    await openRoutes();
    expect(await screen.findByText('Маршрутов пока нет')).toBeOnTheScreen();
  });

  it('пусто с фильтрами — «Ничего не найдено» и сброс', async () => {
    await openRoutes();
    await screen.findByRole('link', { name: ringLabel });
    listRoutes.mockImplementation((params = {}) =>
      Promise.resolve(page(params.distance?.includes('lt50') ? [] : [ring])),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'до 50 км' }));
    expect(await screen.findByText('Ничего не найдено')).toBeOnTheScreen();
    expect(screen.getByText('Нет маршрутов по выбранным фильтрам.')).toBeOnTheScreen();
    const resets = screen.getAllByRole('button', { name: 'Сбросить фильтры' });
    await fireEvent.press(resets[1]!);
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
  });

  it('ошибка без данных — «Не удалось загрузить» с повтором, чипы на месте', async () => {
    listRoutes.mockRejectedValue(failure());
    await openRoutes();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Асфальт' })).toBeOnTheScreen();
    listRoutes.mockResolvedValue(page([ring]));
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
  });

  it('ошибка городов — группы «Город» нет, список работает', async () => {
    listCities.mockRejectedValue(failure());
    await openRoutes();
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Город')).toBeNull());
  });

  it('догрузка по курсору; ошибка догрузки — баннер в подвале, данные остаются; повтор', async () => {
    listRoutes.mockImplementation((params = {}) =>
      params.cursor ? Promise.reject(failure()) : Promise.resolve(page([ring], 'c2')),
    );
    await openRoutes();
    await screen.findByRole('link', { name: ringLabel });
    await act(async () => {
      feed().props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: ringLabel })).toBeOnTheScreen();

    listRoutes.mockResolvedValue(page([route({ title: 'Догружен' })]));
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByText('Догружен')).toBeOnTheScreen();
    expect(listRoutes).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c2' }));
  });

  it('pull-to-refresh перезапрашивает список и города; исчезнувший город снимается', async () => {
    await openRoutes();
    await screen.findByRole('link', { name: ringLabel });
    await fireEvent.press(screen.getByRole('button', { name: 'Брест' }));
    expect(listRoutes).toHaveBeenLastCalledWith(expect.objectContaining({ city: ['brest'] }));

    listCities.mockResolvedValue({ cities: ['minsk'] });
    const before = listCities.mock.calls.length;
    await refresh();
    expect(listCities.mock.calls.length).toBeGreaterThan(before);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Брест' })).toBeNull());
    // ключ без города — выдача без фильтров (из свежего кэша); сброса нет
    expect(await screen.findByRole('link', { name: ringLabel })).toBeOnTheScreen();
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
  });
});
