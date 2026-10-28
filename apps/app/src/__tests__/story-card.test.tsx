/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RaceResultsPage } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
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
  finisher,
  finishersPage,
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
  storyPreviewSource: jest.fn((file: { uri: string }) => ({ uri: file.uri, release: jest.fn() })),
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

describe('финишёры (ревью pass 2, §8.2)', () => {
  it('своя строка во вкладке «Финишёры» не нажимается (вход — только «Ваше участие»)', async () => {
    jest
      .mocked(api.getRaceFinishers)
      .mockResolvedValue(finishersPage([finisher({ entryId: ENTRY_ID, elapsedSec: 6125 })]));
    getRaceResults.mockResolvedValue(
      resultsPage([row({ entryId: RIVAL_ENTRY_ID, place: 1, elapsedSec: 5400 })], {
        group: 'm_u40',
        groups: [{ key: 'm_u40', ranked: 1 }],
        finishers: 1,
      }),
    );
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'finisher', elapsedSec: 6125, unranked: 'start' }),
        actions: actions({ canWithdraw: true, canAddAttempt: true, canShareStory: true }),
      }),
    );
    await open(`/races/${RACE_ID}`);
    expect(await screen.findByRole('button', { name: SHARE })).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Финишёры' }));
    expect(await screen.findByLabelText(/^Вы, 1:42:05/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Вы, .*Открыть карточку$/ })).toBeNull();
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

describe('превью — подготовленный локальный файл (ревью pass 2)', () => {
  it('файл ещё готовится — скелетон, превью нет; готов — превью локального файла', async () => {
    getStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    let resolve: (file: { url: string; uri: string }) => void = () => undefined;
    jest.mocked(prepareStory).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await open(storyUrl);
    expect(await screen.findByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-preview')).toBeNull();
    await act(async () => {
      resolve({ url: 'https://api.test/x.png', uri: 'file:///cache/story-local.png' });
    });
    const preview = await screen.findByTestId('story-preview');
    expect(JSON.stringify(preview.props.source)).toContain('file:///cache/story-local.png');
  });

  it('превью не отрисовалось — баннер с «Повторить» (выключена на время повтора) → превью', async () => {
    getStoryCard.mockResolvedValue({ status: 'ready', token: TOKEN });
    await open(storyUrl);
    const preview = await screen.findByTestId('story-preview');
    await act(async () => {
      // загрузчик изображения не прочитал файл (нативное событие `onError` expo-image)
      fireEvent(preview, 'error', { nativeEvent: { error: 'decode' } });
    });
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-preview')).toBeNull();

    let resolve: (file: { url: string; uri: string }) => void = () => undefined;
    jest.mocked(prepareStory).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Повторить' })).toBeDisabled());
    await act(async () => {
      resolve({ url: 'https://api.test/x.png', uri: 'file:///cache/story-again.png' });
    });
    expect(await screen.findByTestId('story-preview')).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });
});

describe('превью: сеть и смена шаблона (ревью pass 3)', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('ready из кэша, файла нет, сети нет — «Нет соединения» с повтором; сеть вернулась — превью', async () => {
    const client = createTestQueryClient();
    client.setQueryData(['races', 'story', RACE_ID, 'line'], { status: 'ready', token: TOKEN });
    onlineManager.setOnline(false);
    await open(storyUrl, client);
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
    expect(screen.queryByTestId('story-preview')).toBeNull();
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(await screen.findByTestId('story-preview')).toBeOnTheScreen();
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });

  it('ошибка превью одного шаблона не переносится на другой, уже готовый (оба в кэше)', async () => {
    const OTHER = 'ZyXwVuTsRqPoNmLkJiHg_-';
    getStoryCard.mockImplementation((_token, _race, { template }) =>
      Promise.resolve({ status: 'ready', token: template === 'night' ? OTHER : TOKEN }),
    );
    const client = createTestQueryClient();
    client.setQueryData(['races', 'story', RACE_ID, 'line'], { status: 'ready', token: TOKEN });
    client.setQueryData(['races', 'story', RACE_ID, 'night'], { status: 'ready', token: OTHER });
    await open(storyUrl, client);
    const preview = await screen.findByTestId('story-preview');
    await act(async () => {
      fireEvent(preview, 'error', { nativeEvent: { error: 'decode' } });
    });
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Ночь'));
    expect(await screen.findByTestId('story-preview')).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
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

  it('404 — ошибка с повтором, не «Карточки пока нет» (поведение до общей панели)', async () => {
    getStoryCard.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await open(storyUrl);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeOnTheScreen();
    expect(screen.queryByText('Карточки пока нет')).toBeNull();
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
