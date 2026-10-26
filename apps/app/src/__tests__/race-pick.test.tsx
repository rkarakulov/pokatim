/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDocumentAsync } from 'expo-document-picker';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import RacePickRoute from '../app/races/pick/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { upload } from './devices-fixtures';
import { FakeXhr } from './fake-xhr';
import { createQueryWrapper } from './query-wrapper';
import {
  attempt,
  candidate,
  candidates,
  corridorRace,
  myEntry,
  RACE_ID,
  resultsPage,
  UPLOAD_ID,
} from './races-fixtures';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const listCandidates = jest.mocked(api.listAttemptCandidates);
const addRaceAttempt = jest.mocked(api.addRaceAttempt);

/** «Сейчас»: 8 октября 2026, 21:00 по Минску. */
const NOW = new Date('2026-10-08T18:00:00Z');
const TOKEN = liveSession.accessToken;
const OTHER_ACTIVITY = '0199d000-0000-7000-8000-0000000000a2';
const never = () => new Promise<never>(() => undefined);

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};

const routes = { ...tabRoutes, 'races/[id]': RaceRoute, 'races/pick/[id]': RacePickRoute };
const openPick = (id = RACE_ID) =>
  renderRouter(routes, { initialUrl: `/races/pick/${id}`, wrapper: createQueryWrapper() });

const attemptedLabel = '8 октября, 19:42 · Garmin · 62,3 км · 1:46:40 · Уже в гонке';
const freeLabel = '7 октября, 08:00 · Файл · 40 км · 1:30:00';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  jest.mocked(api.getRace).mockResolvedValue(corridorRace());
  jest.mocked(api.getMyRaceEntry).mockResolvedValue(myEntry());
  jest.mocked(api.getRaceResults).mockResolvedValue(resultsPage());
  listCandidates.mockResolvedValue(
    candidates(
      candidate({ attempted: true }),
      candidate({
        activityId: OTHER_ACTIVITY,
        // 7 октября, 08:00 по Минску
        startedAt: '2026-10-07T05:00:00Z',
        source: 'upload',
        elapsedSec: 5400,
        distanceM: 40_000,
      }),
    ),
  );
});
const realXhr = global.XMLHttpRequest;
const realFetch = global.fetch;
afterEach(() => {
  global.XMLHttpRequest = realXhr;
  global.fetch = realFetch;
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

describe('«Выбрать свой заезд» (AC8)', () => {
  it('гость по прямой ссылке — гард ведёт на регистрацию', async () => {
    const router = await renderRouter(appRoutes, { initialUrl: `/races/pick/${RACE_ID}` });

    expect(await screen.findByRole('header', { name: 'Создать аккаунт' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/register');
    expect(listCandidates).not.toHaveBeenCalled();
  });

  it('заголовок сразу, на месте списка — скелетон', async () => {
    signedIn();
    listCandidates.mockReturnValueOnce(never());
    await openPick();
    expect(await screen.findByRole('header', { name: 'Выбрать свой заезд' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    expect(listCandidates).toHaveBeenCalledWith(TOKEN, RACE_ID);
  });

  it('список: дата, источник, км, длительность; добавленный — выключен с «Уже в гонке»', async () => {
    signedIn();
    await openPick();

    const attempted = await screen.findByRole('button', { name: attemptedLabel });
    expect(attempted).toBeDisabled();
    expect(screen.getByText('Уже в гонке')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: freeLabel })).toBeEnabled();
    expect(screen.getByText('8 октября, 19:42')).toBeOnTheScreen();

    await fireEvent.press(attempted);
    expect(addRaceAttempt).not.toHaveBeenCalled();
  });

  it('выбор → addRaceAttempt({ activityId }) → назад к карточке гонки', async () => {
    signedIn();
    addRaceAttempt.mockResolvedValue(
      myEntry({ attempts: [attempt({ status: 'queued', segment: null, isBest: false })] }),
    );
    const router = await renderRouter(routes, {
      initialUrl: `/races/${RACE_ID}`,
      wrapper: createQueryWrapper(),
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Выбрать свой заезд' }));
    expect(router.getPathname()).toBe(`/races/pick/${RACE_ID}`);

    await fireEvent.press(await screen.findByRole('button', { name: freeLabel }));
    expect(addRaceAttempt).toHaveBeenCalledWith(TOKEN, RACE_ID, { activityId: OTHER_ACTIVITY });
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
    // кеш участия обновлён ответом мутации
    expect(await screen.findByText('В очереди на проверку')).toBeOnTheScreen();
  });

  it('без истории — replace на карточку гонки', async () => {
    signedIn();
    addRaceAttempt.mockResolvedValue(myEntry());
    const router = await openPick();

    await fireEvent.press(await screen.findByRole('button', { name: freeLabel }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
  });

  it('ошибка мутации — баннер с текстом кода', async () => {
    signedIn();
    addRaceAttempt.mockRejectedValue(
      new ApiHttpError(409, { code: 'ATTEMPT_SOURCE_INVALID', message: 'x' }),
    );
    const router = await openPick();

    await fireEvent.press(await screen.findByRole('button', { name: freeLabel }));
    expect(await screen.findByText('Этот заезд нельзя добавить в гонку')).toBeOnTheScreen();
    expect(router.getPathname()).toBe(`/races/pick/${RACE_ID}`);
  });

  it('пусто — EmptyState', async () => {
    signedIn();
    listCandidates.mockResolvedValue(candidates());
    await openPick();

    expect(await screen.findByText('Нет заездов в окне гонки')).toBeOnTheScreen();
    expect(
      screen.getByText('Загрузите файл заезда или дождитесь импорта Garmin/Wahoo.'),
    ).toBeOnTheScreen();
  });

  it('пусто — «Загрузить заезд»: файл → загрузка → addRaceAttempt({ uploadId }) → карточка гонки (B8)', async () => {
    signedIn();
    listCandidates.mockResolvedValue(candidates());
    jest.mocked(getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ name: 'ride.gpx', size: 1024, uri: 'file:///cache/ride.gpx', lastModified: 0 }],
    });
    jest.mocked(api.trackUploadRequest).mockReturnValue({
      url: 'https://api.example/v1/tracks/uploads?name=ride.gpx',
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' },
    });
    FakeXhr.last = undefined;
    global.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    global.fetch = jest.fn(async () => ({ blob: async () => ({ size: 1024 }) })) as never;
    addRaceAttempt.mockResolvedValue(
      myEntry({ attempts: [attempt({ status: 'queued', segment: null, isBest: false })] }),
    );
    const router = await openPick();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить заезд' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await act(async () => FakeXhr.last?.progress(42, 100));
    expect(screen.getByText('Загружаем ride.gpx: 42%')).toBeOnTheScreen();

    await act(async () => FakeXhr.last?.respond(202, upload({ status: 'queued', activity: null })));
    await waitFor(() =>
      expect(addRaceAttempt).toHaveBeenCalledWith(TOKEN, RACE_ID, { uploadId: UPLOAD_ID }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
  });

  it.each([
    ['нет сети', new ApiNetworkError(new TypeError('Network request failed')), 'Нет соединения'],
    ['сбой API', new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }), 'Не удалось загрузить'],
  ])('ошибка без данных (%s) — «%s» с повтором', async (_case, error, title) => {
    signedIn();
    listCandidates.mockRejectedValueOnce(error);
    await openPick();

    expect(await screen.findByText(title)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: freeLabel })).toBeOnTheScreen();
  });

  it('невалидный id — «Гонка не найдена» без запроса', async () => {
    signedIn();
    await openPick('nope');

    expect(await screen.findByText('Гонка не найдена')).toBeOnTheScreen();
    expect(listCandidates).not.toHaveBeenCalled();
  });
});
