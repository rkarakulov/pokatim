/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RideDetail, RideView } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { shareStory } from '@/lib/share-story';

import RideRoute from '../app/rides/[id]';
import RideInviteRoute from '../app/rides/invite/[id]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/lib/share-link', () => ({ shareLink: jest.fn(), shareOrigin: jest.fn(() => null) }));
jest.mock('@/lib/share-story', () => ({
  prepareStory: jest.fn((url: string) => Promise.resolve({ url, uri: 'file:///cache/invite.png' })),
  storyShareMode: jest.fn(() => 'share'),
  storyPreviewSource: jest.fn((file: { uri: string }) => ({ uri: file.uri, release: jest.fn() })),
  shareStory: jest.fn(() => Promise.resolve('shared')),
}));

const getRide = jest.mocked(api.getRide);
const getRideForViewer = jest.mocked(api.getRideForViewer);
const getRideInviteCard = jest.mocked(api.getRideInviteCard);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');
const ID = '0190a6f4-0000-7000-8000-000000000011';
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const INVITE = 'Карточка-приглашение';

const detail: RideDetail = {
  id: ID,
  title: 'Кофе-райд на Минское море',
  organizerName: null,
  startsAt: '2026-10-04T07:00:00Z',
  city: 'minsk',
  place: 'Парк Победы',
  distanceKm: 42,
  paceMinKmh: 22,
  paceMaxKmh: 24,
  limit: 12,
  goingCount: 3,
  full: false,
  phase: 'upcoming',
  cancelReason: null,
  rescheduledAt: null,
  route: null,
  start: null,
  description: null,
};
const view = (ride: Partial<RideDetail> = {}): RideView => ({
  ride: { ...detail, ...ride },
  viewer: {
    role: 'none',
    canJoin: true,
    canLeave: false,
    canManage: false,
    reported: false,
    canReport: false,
  },
});

const routes = {
  ...tabRoutes,
  'rides/[id]': RideRoute,
  'rides/invite/[id]': RideInviteRoute,
  'rides/report/[id]': () => <Text>Жалоба</Text>,
};
const open = (url: string) =>
  renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getRide.mockResolvedValue(detail);
  getRideForViewer.mockResolvedValue(view());
  jest
    .mocked(api.storyCardImageUrl)
    .mockImplementation((token) => `https://api.test/v1/story-cards/${token}.png`);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('вход с карточки райда', () => {
  it('будущий райд, вошедший — кнопка ведёт на экран приглашения', async () => {
    getRideInviteCard.mockResolvedValue({ status: 'pending' });
    const router = await open(`/rides/${ID}`);
    await fireEvent.press(await screen.findByRole('button', { name: INVITE }));
    expect(router.getPathname()).toBe(`/rides/invite/${ID}`);
  });

  it('прошедший райд — кнопки нет', async () => {
    getRide.mockResolvedValue({ ...detail, phase: 'past' });
    getRideForViewer.mockResolvedValue(view({ phase: 'past' }));
    await open(`/rides/${ID}`);
    expect(await screen.findAllByText('Кофе-райд на Минское море')).not.toHaveLength(0);
    await waitFor(() => expect(getRideForViewer).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: INVITE })).toBeNull();
  });
});

describe('экран приглашения', () => {
  it('pending → ready: превью и «Поделиться» отдают локальный PNG', async () => {
    getRideInviteCard
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(`/rides/invite/${ID}`);
    expect(getRideInviteCard).toHaveBeenCalledWith(expect.any(String), ID, { template: 'line' });
    const preview = await screen.findByTestId('story-preview', {}, { timeout: 5000 });
    expect(preview.props.accessibilityLabel).toBe(
      'Карточка-приглашение: Кофе-райд на Минское море',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Поделиться' })).not.toBeDisabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    expect(shareStory).toHaveBeenCalledWith(
      { url: `https://api.test/v1/story-cards/${TOKEN}.png`, uri: 'file:///cache/invite.png' },
      INVITE,
    );
  });

  it('шаблон «Ночь» — свой запрос', async () => {
    getRideInviteCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(`/rides/invite/${ID}`);
    await screen.findByTestId('story-preview');
    await fireEvent.press(screen.getByText('Ночь'));
    await waitFor(() =>
      expect(getRideInviteCard).toHaveBeenCalledWith(expect.any(String), ID, {
        template: 'night',
      }),
    );
  });

  it.each([
    [409, 'STORY_CARD_UNAVAILABLE'],
    [404, 'NOT_FOUND'],
  ])('%i %s — «Приглашение недоступно» и «К райду»', async (status, code) => {
    getRideInviteCard.mockRejectedValue(new ApiHttpError(status, { code, message: 'x' }));
    const router = await open(`/rides/invite/${ID}`);
    expect(await screen.findByText('Приглашение недоступно')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К райду' }));
    expect(router.getPathname()).toBe(`/rides/${ID}`);
  });

  it('кривой id — без запроса, «Приглашение недоступно»', async () => {
    await open('/rides/invite/not-a-uuid');
    expect(await screen.findByText('Приглашение недоступно')).toBeOnTheScreen();
    expect(getRideInviteCard).not.toHaveBeenCalled();
  });
});
