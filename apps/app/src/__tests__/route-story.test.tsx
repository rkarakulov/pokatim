/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CatalogRouteDetail } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { shareStory } from '@/lib/share-story';

import RouteStoryRoute from '../app/routes/story/[id]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/lib/share-story', () => ({
  prepareStory: jest.fn((url: string) => Promise.resolve({ url, uri: 'file:///cache/route.png' })),
  storyShareMode: jest.fn(() => 'share'),
  storyPreviewSource: jest.fn((file: { uri: string }) => ({ uri: file.uri, release: jest.fn() })),
  shareStory: jest.fn(() => Promise.resolve('shared')),
}));

const getRouteStoryCard = jest.mocked(api.getRouteStoryCard);
const getRoute = jest.mocked(api.getCatalogRoute);

const ID = '0190a6f4-0000-7000-8000-000000000021';
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const TITLE = 'Карточка маршрута';

const route = {
  id: ID,
  title: 'Минское кольцо',
  distanceM: 68_400,
  elevationGainM: 620,
  isLoop: true,
  city: 'minsk',
  surfaces: ['asphalt'],
  publishedAt: '2026-10-20T10:00:00.000Z',
  author: { kind: 'team' },
  elevation: null,
  gpxAvailable: false,
} as unknown as CatalogRouteDetail;

const routes = {
  ...tabRoutes,
  'routes/[id]': () => <Text>Карточка каталога</Text>,
  'routes/story/[id]': RouteStoryRoute,
};
const open = (url: string) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getRoute.mockResolvedValue(route);
  jest.mocked(api.listCatalogRoutes).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.listCatalogRouteCities).mockResolvedValue({ cities: [] });
  jest
    .mocked(api.storyCardImageUrl)
    .mockImplementation((token) => `https://api.test/v1/story-cards/${token}.png`);
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('экран карточки маршрута', () => {
  it('pending → ready: превью с названием маршрута и «Поделиться» отдают локальный PNG', async () => {
    getRouteStoryCard
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(`/routes/story/${ID}`);
    expect(getRouteStoryCard).toHaveBeenCalledWith(expect.any(String), ID, { template: 'line' });
    const preview = await screen.findByTestId('story-preview', {}, { timeout: 5000 });
    expect(preview.props.accessibilityLabel).toBe('Карточка маршрута «Минское кольцо»');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Поделиться' })).not.toBeDisabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    expect(shareStory).toHaveBeenCalledWith(
      { url: `https://api.test/v1/story-cards/${TOKEN}.png`, uri: 'file:///cache/route.png' },
      TITLE,
    );
  });

  it('шаблон «Ночь» — свой запрос', async () => {
    getRouteStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(`/routes/story/${ID}`);
    await screen.findByTestId('story-preview');
    await fireEvent.press(screen.getByText('Ночь'));
    await waitFor(() =>
      expect(getRouteStoryCard).toHaveBeenCalledWith(expect.any(String), ID, {
        template: 'night',
      }),
    );
  });

  it('404 NOT_FOUND — «Карточка недоступна» и «К маршруту»', async () => {
    getRouteStoryCard.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    const router = await open(`/routes/story/${ID}`);
    expect(await screen.findByText('Карточка недоступна')).toBeOnTheScreen();
    expect(screen.getByText('Маршрута больше нет в каталоге.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К маршруту' }));
    expect(router.getPathname()).toBe(`/routes/${ID}`);
  });

  it('500 — ошибка с повтором (не пустое состояние); повтор — превью', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    getRouteStoryCard.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await open(`/routes/story/${ID}`);
    await act(async () => {
      // 5xx повторяется с паузами (ретраи TanStack), затем — ошибка
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
    expect(screen.queryByText('Карточка недоступна')).toBeNull();
    getRouteStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('story-preview')).toBeOnTheScreen();
    jest.useRealTimers();
  });

  it('кривой id — без запроса, «Карточка недоступна»', async () => {
    await open('/routes/story/not-a-uuid');
    expect(await screen.findByText('Карточка недоступна')).toBeOnTheScreen();
    expect(getRouteStoryCard).not.toHaveBeenCalled();
  });
});
