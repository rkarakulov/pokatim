/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { Achievement } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { shareStory } from '@/lib/share-story';

import AchievementRoute from '../app/achievements/[code]';
import AchievementStoryRoute from '../app/achievements/story/[code]';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');
jest.mock('@/lib/share-story', () => ({
  prepareStory: jest.fn((url: string) =>
    Promise.resolve({ url, uri: 'file:///cache/achievement.png' }),
  ),
  storyShareMode: jest.fn(() => 'share'),
  storyPreviewSource: jest.fn((file: { uri: string }) => ({ uri: file.uri, release: jest.fn() })),
  shareStory: jest.fn(() => Promise.resolve('shared')),
}));

const getAchievementCard = jest.mocked(api.getAchievementCard);
const listAchievements = jest.mocked(api.listAchievements);

const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const RACE_ID = '0190a6f4-0000-7000-8000-000000000201';
const SEASON_ID = '0190a6f4-0000-7000-8000-000000000401';

const win: Achievement = {
  code: 'race_win',
  object: { kind: 'race', id: RACE_ID, title: 'Гонка у озера' },
  factDate: '2026-05-02',
  level: null,
  seen: true,
};
const champion: Achievement = {
  code: 'season_champion',
  object: { kind: 'season', id: SEASON_ID, title: 'Сезон 2025' },
  factDate: '2025-10-31',
  level: null,
  seen: true,
};
const route: Achievement = {
  code: 'route_first',
  object: { kind: 'route', id: RACE_ID, title: 'Петля' },
  factDate: '2026-04-01',
  level: null,
  seen: true,
};

const open = (url: string) =>
  renderRouter(
    {
      'achievements/[code]': AchievementRoute,
      'achievements/story/[code]': AchievementStoryRoute,
      'races/story/[id]': () => <Text>Сторис результата</Text>,
      'seasons/[id]': () => <Text>Сезон</Text>,
      profile: () => <Text>Профиль</Text>,
    },
    { initialUrl: url, wrapper: createQueryWrapper() },
  );

beforeEach(() => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  listAchievements.mockResolvedValue({ progress: [], items: [win, route, champion] });
  jest
    .mocked(api.storyCardImageUrl)
    .mockImplementation((token) => `https://api.test/v1/story-cards/${token}.png`);
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('вход с экрана достижения (A6)', () => {
  it('гоночное: «Поделиться» → карточка достижения, «Сторис результата» → сторис гонки', async () => {
    getAchievementCard.mockResolvedValue({ status: 'pending' });
    const router = await open('/achievements/race_win');
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(router.getPathname()).toBe('/achievements/story/race_win');

    const second = await open('/achievements/race_win');
    await fireEvent.press(await screen.findByRole('button', { name: 'Сторис результата' }));
    expect(second.getPathname()).toBe(`/races/story/${RACE_ID}`);
  });

  it('маршрутное: «Поделиться» есть, «Сторис результата» — нет', async () => {
    const router = await open('/achievements/route_first');
    expect(await screen.findByRole('header', { name: 'Первый маршрут' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Сторис результата' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    expect(router.getPathname()).toBe('/achievements/story/route_first');
  });

  it('сезонное: «Поделиться» (перед «К сезону») → карточка с `?season=` (C1)', async () => {
    getAchievementCard.mockResolvedValue({ status: 'pending' });
    const router = await open(`/achievements/season_champion?season=${SEASON_ID}`);
    const share = await screen.findByRole('button', { name: 'Поделиться' });
    const buttons = screen.getAllByRole('button');
    const toSeason = screen.getByRole('button', { name: 'К сезону' });
    expect(buttons.indexOf(share)).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf(share)).toBeLessThan(buttons.indexOf(toSeason));
    await fireEvent.press(share);
    expect(router.getPathname()).toBe('/achievements/story/season_champion');
    expect(router.getSearchParams()).toMatchObject({ season: SEASON_ID });
  });
});

describe('экран карточки достижения', () => {
  it('pending → ready: превью и «Поделиться» отдают локальный PNG', async () => {
    getAchievementCard
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'ready', token: TOKEN });
    await open('/achievements/story/race_win');
    expect(getAchievementCard).toHaveBeenCalledWith(expect.any(String), 'race_win', {
      template: 'line',
    });
    const preview = await screen.findByTestId('story-preview', {}, { timeout: 5000 });
    expect(preview.props.accessibilityLabel).toBe('Карточка достижения «Победа»');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Поделиться' })).not.toBeDisabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    expect(shareStory).toHaveBeenCalledWith(
      { url: `https://api.test/v1/story-cards/${TOKEN}.png`, uri: 'file:///cache/achievement.png' },
      'Победа',
    );
  });

  it('шаблон «Ночь» — свой запрос', async () => {
    getAchievementCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await open('/achievements/story/race_win');
    await screen.findByTestId('story-preview');
    await fireEvent.press(screen.getByText('Ночь'));
    await waitFor(() =>
      expect(getAchievementCard).toHaveBeenCalledWith(expect.any(String), 'race_win', {
        template: 'night',
      }),
    );
  });

  it('409 — «Карточки нет» и «К достижению»', async () => {
    getAchievementCard.mockRejectedValue(
      new ApiHttpError(409, { code: 'STORY_CARD_UNAVAILABLE', message: 'x' }),
    );
    const router = await open('/achievements/story/race_win');
    expect(await screen.findByText('Карточки нет')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К достижению' }));
    expect(router.getPathname()).toBe('/achievements/race_win');
  });

  it('ошибка сервера — «Не удалось загрузить» с повтором', async () => {
    getAchievementCard.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await open('/achievements/story/race_win');
    expect(
      await screen.findByText('Не удалось загрузить', {}, { timeout: 5000 }),
    ).toBeOnTheScreen();
    getAchievementCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('story-preview')).toBeOnTheScreen();
  });

  it('сезонное с `?season=`: запрос с сезоном, превью; «К достижению» — экран сезонного (409)', async () => {
    getAchievementCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(`/achievements/story/season_champion?season=${SEASON_ID}`);
    const preview = await screen.findByTestId('story-preview', {}, { timeout: 5000 });
    expect(preview.props.accessibilityLabel).toBe('Карточка достижения «Чемпион сезона»');
    expect(getAchievementCard).toHaveBeenCalledWith(expect.any(String), 'season_champion', {
      template: 'line',
      seasonId: SEASON_ID,
    });

    getAchievementCard.mockRejectedValue(
      new ApiHttpError(409, { code: 'STORY_CARD_UNAVAILABLE', message: 'x' }),
    );
    const router = await open(`/achievements/story/season_podium?season=${SEASON_ID}`);
    expect(await screen.findByText('Карточки нет')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К достижению' }));
    await waitFor(() => expect(router.getPathname()).toBe('/achievements/season_podium'));
    expect(router.getSearchParams()).toMatchObject({ season: SEASON_ID });
  });

  it('сезонный код без `?season=` или с кривым — без запроса, «Карточки нет» → профиль', async () => {
    for (const url of [
      '/achievements/story/season_champion',
      '/achievements/story/season_champion?season=not-a-uuid',
    ]) {
      const router = await open(url);
      expect(await screen.findByText('Карточки нет')).toBeOnTheScreen();
      expect(getAchievementCard).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: 'К достижению' }));
      await waitFor(() => expect(router.getPathname()).toBe('/profile'));
    }
  });

  it('несезонное с `?season=` — сезон игнорируется (RC-8)', async () => {
    getAchievementCard.mockResolvedValue({ status: 'pending' });
    await open(`/achievements/story/race_win?season=${SEASON_ID}`);
    await waitFor(() =>
      expect(getAchievementCard).toHaveBeenCalledWith(expect.any(String), 'race_win', {
        template: 'line',
      }),
    );
  });

  it('незнакомый код — без запроса, «Карточки нет» → профиль', async () => {
    const router = await open('/achievements/story/unknown_code');
    expect(await screen.findByText('Карточки нет')).toBeOnTheScreen();
    expect(getAchievementCard).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'К достижению' }));
    await waitFor(() => expect(router.getPathname()).toBe('/profile'));
  });
});
