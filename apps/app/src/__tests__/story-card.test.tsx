/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RaceResultsPage } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';
import { prepareStory } from '@/lib/share-story';

import RaceRoute from '../app/races/[id]';
import RivalResultRoute from '../app/races/result/[id]/[entryId]';
import StoryCardRoute from '../app/races/story/[id]';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { myDisputes, RIVAL_ENTRY_ID } from './disputes-fixtures';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';
import {
  actions,
  corridorRace,
  ENTRY_ID,
  myEntry,
  RACE_ID,
  result,
  resultsPage,
  row,
} from './races-fixtures';

jest.mock('@/lib/api');
jest.mock('@/lib/share-story', () => ({
  prepareStory: jest.fn((url: string) => Promise.resolve({ url, uri: 'file:///cache/story.png' })),
  storyShareMode: jest.fn(() => 'share'),
  shareStory: jest.fn(() => Promise.resolve('shared')),
}));

const getRace = jest.mocked(api.getRace);
const getRaceResults = jest.mocked(api.getRaceResults);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);
const getMyRaceDisputes = jest.mocked(api.getMyRaceDisputes);
const getStoryCard = jest.mocked(api.getStoryCard);
const storyCardImageUrl = jest.mocked(api.storyCardImageUrl);

const NOW = new Date('2026-10-09T18:00:00Z');
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const storyUrl = `/races/story/${RACE_ID}`;
const SHARE = 'Поделиться в сторис';

const timed = (canShareStory: boolean) =>
  myEntry({
    result: result({ status: 'provisional', elapsedSec: 6125, place: 2, ranked: 3 }),
    actions: actions({ canWithdraw: true, canAddAttempt: true, canShareStory }),
  });

const routes = {
  ...tabRoutes,
  'races/[id]': RaceRoute,
  'races/result/[id]/[entryId]': RivalResultRoute,
  'races/story/[id]': StoryCardRoute,
};
const open = (url: string, client = createTestQueryClient()) => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  return renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper(client) });
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRace.mockResolvedValue(corridorRace());
  getRaceResults.mockResolvedValue(
    resultsPage([
      row({ entryId: RIVAL_ENTRY_ID, place: 1, elapsedSec: 5400 }),
      row({ entryId: ENTRY_ID, place: 2, elapsedSec: 6125 }),
    ]),
  );
  getMyRaceEntry.mockResolvedValue(timed(true));
  getMyRaceDisputes.mockResolvedValue(myDisputes());
  storyCardImageUrl.mockImplementation((token) => `https://api.test/v1/story-cards/${token}.png`);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('входы (R8)', () => {
  it('«Ваше участие»: кнопка при canShareStory → экран карточки', async () => {
    const router = await open(`/races/${RACE_ID}`);
    await fireEvent.press(await screen.findByRole('button', { name: SHARE }));
    expect(router.getPathname()).toBe(storyUrl);
  });

  it('без canShareStory (и старый ответ без поля) — кнопки нет, своя строка не нажимаема', async () => {
    getMyRaceEntry.mockResolvedValue(timed(false));
    await open(`/races/${RACE_ID}`);
    expect(await screen.findByLabelText('2, Вы, 1:42:05')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: SHARE })).toBeNull();
  });

  it('своя строка таблицы → «Ваш результат», время, «Поделиться в сторис», без подачи спора', async () => {
    const router = await open(`/races/${RACE_ID}`);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Вы, 2 место, 1:42:05. Открыть карточку' }),
    );
    expect(router.getPathname()).toBe(`/races/result/${RACE_ID}/${ENTRY_ID}`);
    expect(await screen.findAllByText('Ваш результат')).not.toHaveLength(0);
    expect(await screen.findByText('1:42:05')).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: SHARE })).toBeOnTheScreen();
    expect(screen.queryByText('Оспорить результат')).toBeNull();
    // чужая строка — по-прежнему карточка соперника
    expect(getMyRaceDisputes).toHaveBeenCalled();
  });
});

describe('своя строка в группе не по умолчанию (ревью pass 1)', () => {
  it('своя заявка в w_u40 при группе сервера m_u40 — «Ваш результат» с кнопкой, путь с ?group', async () => {
    const groups: RaceResultsPage['groups'] = [
      { key: 'm_u40', ranked: 1 },
      { key: 'w_u40', ranked: 1 },
    ];
    getRaceResults.mockImplementation((_id, params = {}) =>
      Promise.resolve(
        params.group === 'w_u40'
          ? resultsPage([row({ entryId: ENTRY_ID, place: 1, elapsedSec: 6125 })], {
              group: 'w_u40',
              groups,
            })
          : resultsPage([row({ entryId: RIVAL_ENTRY_ID, place: 1, elapsedSec: 5400 })], {
              group: 'm_u40',
              groups,
            }),
      ),
    );
    getMyRaceEntry.mockResolvedValue({
      ...timed(true),
      entry: { ...timed(true).entry!, groupKey: 'w_u40' },
    });
    const router = await open(`/races/${RACE_ID}`);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Вы, 1 место, 1:42:05. Открыть карточку' }),
    );
    expect(router.getPathname()).toBe(`/races/result/${RACE_ID}/${ENTRY_ID}`);
    expect(router.getSearchParams()).toMatchObject({ group: 'w_u40' });
    expect(await screen.findByRole('button', { name: SHARE })).toBeOnTheScreen();
    expect(screen.queryByText('Результат не найден')).toBeNull();
  });
});

describe('экран карточки: ошибки при показанных данных (ревью pass 1)', () => {
  it('ready → ошибка обновления: превью остаётся, сверху баннер с повтором', async () => {
    getStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    const client = createTestQueryClient();
    await open(storyUrl, client);
    await screen.findByTestId('story-preview');
    getStoryCard.mockRejectedValue(new ApiNetworkError(new TypeError('offline')));
    await act(async () => {
      void client.refetchQueries({ queryKey: ['races', 'story', RACE_ID, 'line'], exact: true });
      // сетевая ошибка повторяется с паузами (ретраи TanStack), затем — ошибка обновления
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
    expect(screen.getByTestId('story-preview')).toBeOnTheScreen();
  });

  it('PNG не скачался — баннер с «Повторить»; повтор готовит файл и включает «Поделиться»', async () => {
    getStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    jest.mocked(prepareStory).mockRejectedValueOnce(new ApiNetworkError(new TypeError('offline')));
    await open(storyUrl);
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(prepareStory).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Поделиться' })).not.toBeDisabled(),
    );
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });
});

describe('экран карточки (R9)', () => {
  it('pending — скелетон, опрос раз в секунду; ready — превью и «Поделиться»', async () => {
    getStoryCard
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(storyUrl);
    expect(await screen.findByLabelText('Загрузка')).toBeOnTheScreen();
    expect(getStoryCard).toHaveBeenCalledWith(liveSession.accessToken, RACE_ID, {
      template: 'line',
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100);
    });
    expect(await screen.findByTestId('story-preview')).toBeOnTheScreen();
    expect(getStoryCard).toHaveBeenCalledTimes(3);
    expect(storyCardImageUrl).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
    expect(
      screen.getByText('Имя на карточке — только с вашим согласием в профиле'),
    ).toBeOnTheScreen();
  });

  it('pending дольше 30 с — «Не удалось загрузить» с повтором; повтор сбрасывает отсчёт', async () => {
    getStoryCard.mockResolvedValue({ status: 'pending' });
    await open(storyUrl);
    await screen.findByLabelText('Загрузка');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(31_000);
    });
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    const calls = getStoryCard.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(30);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    // опрос после ошибки остановлен
    expect(getStoryCard.mock.calls.length).toBe(calls);

    getStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('story-preview')).toBeOnTheScreen();
  });

  it('failed — ошибка с повтором', async () => {
    getStoryCard.mockResolvedValue({ status: 'failed' });
    await open(storyUrl);
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
  });

  it('409 — «Карточки пока нет» и «К гонке»', async () => {
    getStoryCard.mockRejectedValue(
      new ApiHttpError(409, { code: 'STORY_CARD_UNAVAILABLE', message: 'x' }),
    );
    await open(storyUrl);
    expect(await screen.findByText('Карточки пока нет')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'К гонке' })).toBeOnTheScreen();
    expect(getStoryCard).toHaveBeenCalledTimes(1);
  });

  it('смена шаблона — запрос с другим шаблоном', async () => {
    getStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(storyUrl);
    await screen.findByTestId('story-preview');
    await fireEvent.press(screen.getByText('Ночь'));
    await waitFor(() =>
      expect(getStoryCard).toHaveBeenCalledWith(liveSession.accessToken, RACE_ID, {
        template: 'night',
      }),
    );
  });
});
