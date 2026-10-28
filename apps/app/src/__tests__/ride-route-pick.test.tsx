/// <reference types="jest" />
import type { CatalogRouteCard, MyRoute, MyRoutePublication } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { routeChoice } from '@/features/rides/route-choice-store';
import { api } from '@/lib/api';

import RideRoutePickRoute from '../app/rides/route-pick';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const listCatalog = jest.mocked(api.listCatalogRoutes);
const listMine = jest.mocked(api.listMyRoutes);

const NOW = new Date('2026-10-27T09:00:00Z');
let seq = 0;
const nextId = () => `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`;
const team = (title: string): CatalogRouteCard => ({
  id: nextId(),
  title,
  distanceM: 86_000,
  elevationGainM: 412,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-09-01T00:00:00Z',
  author: { kind: 'team' },
});
const publication = (status: MyRoutePublication['status']): MyRoutePublication => ({
  status,
  city: 'minsk',
  surfaces: ['asphalt'],
  showAuthorName: false,
  submittedAt: '2026-10-20T00:00:00Z',
  decidedAt: null,
  rejection: null,
});
const mine = (title: string, overrides: Partial<MyRoute> = {}): MyRoute => ({
  id: nextId(),
  title,
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

const sea = team('Минское море');
const own = mine('Вечерний круг');
const approved = mine('В каталоге', { publication: publication('approved') });
const pending = mine('На проверке', { publication: publication('pending') });
const processing = mine('Обработка', { status: 'processing', distanceM: null });

const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  'rides/new': () => <Text>Форма райда</Text>,
  'rides/route-pick': RideRoutePickRoute,
  'routes/index': () => <Text>Маршруты</Text>,
};
const open = (form = 'new') =>
  renderRouter(routes, {
    initialUrl: `/rides/route-pick?form=${form}`,
    wrapper: createQueryWrapper(),
  });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  routeChoice.clear();
  listCatalog.mockResolvedValue({ items: [sea], nextCursor: null });
  listMine.mockResolvedValue({ items: [own, approved, pending, processing], nextCursor: null });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('выбор маршрута райда (05c)', () => {
  it('«Каталог» по умолчанию; маршрут каталога — выбор public для своей формы и назад к форме', async () => {
    const router = await open();
    expect(screen.getByRole('tab', { name: 'Каталог' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Без маршрута' })).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('link', { name: /^Минское море\. / }));
    expect(router.getPathname()).toBe('/rides/new');
    expect(routeChoice.take('new')).toEqual({
      route: {
        id: sea.id,
        title: 'Минское море',
        distanceM: 86_000,
        elevationGainM: 412,
        access: 'public',
      },
    });
    expect(listMine).not.toHaveBeenCalled();
  });

  it('«Без маршрута» — выбор null', async () => {
    await open('ride-1');
    await fireEvent.press(screen.getByRole('button', { name: 'Без маршрута' }));
    expect(routeChoice.take('ride-1')).toEqual({ route: null });
  });

  it('«Мои»: только готовые; не в каталоге — «Виден только вам», выбор private; одобренный — public', async () => {
    await open();
    await fireEvent.press(screen.getByRole('tab', { name: 'Мои' }));
    expect(await screen.findByRole('link', { name: /^Вечерний круг\. / })).toBeOnTheScreen();
    expect(screen.queryByText('Обработка')).toBeNull();
    // свой и «На проверке» — пометка; «В каталоге» — без неё
    expect(screen.getAllByText('Виден только вам')).toHaveLength(2);

    await fireEvent.press(screen.getByRole('link', { name: /^В каталоге\. / }));
    expect(routeChoice.take('new')?.route?.access).toBe('public');
  });

  it('«Мои» пусто (нет готовых) — приглашение загрузить маршрут', async () => {
    listMine.mockResolvedValue({ items: [processing], nextCursor: null });
    const router = await open();
    await fireEvent.press(screen.getByRole('tab', { name: 'Мои' }));
    expect(await screen.findByText('Нет готовых маршрутов')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Загрузите маршрут' }));
    await waitFor(() => expect(router.getPathname()).toBe('/routes'));
  });

  it('«Мои»: первая страница без готовых, но с курсором — дочитывание, а не «пусто» (ревью pass 1)', async () => {
    listMine
      .mockResolvedValueOnce({ items: [processing], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [own], nextCursor: null });
    await open();
    await fireEvent.press(screen.getByRole('tab', { name: 'Мои' }));
    expect(await screen.findByRole('link', { name: /^Вечерний круг\. / })).toBeOnTheScreen();
    expect(screen.queryByText('Нет готовых маршрутов')).toBeNull();
    expect(listMine).toHaveBeenLastCalledWith(liveSession.accessToken, { limit: 20, cursor: 'c1' });
  });

  it('«Мои»: готовый без дистанции — не строка и не повод «не пусто»', async () => {
    listMine.mockResolvedValue({
      items: [mine('Без длины', { distanceM: null })],
      nextCursor: null,
    });
    await open();
    await fireEvent.press(screen.getByRole('tab', { name: 'Мои' }));
    expect(await screen.findByText('Нет готовых маршрутов')).toBeOnTheScreen();
    expect(screen.queryByText('Без длины')).toBeNull();
  });

  it('каталог пуст — пустое состояние, «Без маршрута» остаётся', async () => {
    listCatalog.mockResolvedValue({ items: [], nextCursor: null });
    await open();
    expect(await screen.findByText('В каталоге пока нет маршрутов')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Без маршрута' })).toBeOnTheScreen();
  });
});
