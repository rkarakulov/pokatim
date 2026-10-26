/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { MyAttemptTrack, RaceRouteMap } from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { myDisputes } from './disputes-fixtures';
import { createQueryWrapper } from './query-wrapper';
import { attempt, corridorRace, myEntry, noEntry, RACE_ID, resultsPage } from './races-fixtures';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getRaceRoute = jest.mocked(api.getRaceRoute);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);
const getMyAttemptTrack = jest.mocked(api.getMyAttemptTrack);

const NOW = new Date('2026-10-08T18:00:00Z');
const LIGHT = 'https://tiles.example/styles/positron';
const BEST = '0199d000-0000-7000-8000-0000000000b1';
const OTHER = '0199d000-0000-7000-8000-0000000000b2';
const route: RaceRouteMap = {
  line: [
    [27.5, 53.8],
    [27.6, 54.0],
  ],
  start: [27.5, 53.8],
  finish: [27.6, 54.0],
  bounds: [27.5, 53.8, 27.6, 54.0],
  widthM: 50,
};
const mapLabel = 'Карта маршрута: 62 км, коридор ±50 м от маршрута, старт и финиш отмечены';
const track = (overrides: Partial<MyAttemptTrack> = {}): MyAttemptTrack => ({
  attemptId: BEST,
  line: [
    [27.49, 53.79],
    [27.55, 53.9],
    [27.61, 54.01],
  ],
  segment: { from: 0.2, to: 1.8 },
  offRuns: [{ from: 1, to: 1.3 }],
  marks: 'ready',
  ...overrides,
});
const rejectedOff = attempt({
  id: BEST,
  status: 'rejected',
  reasons: ['off_corridor'],
  isBest: false,
  segment: { ...attempt().segment!, offCorridorM: 820, maxExcursionM: 640 },
});
const counted = attempt({ id: OTHER, isBest: true });

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};
const openSignedIn = () =>
  renderRouter(
    { ...tabRoutes, 'races/[id]': RaceRoute },
    { initialUrl: `/races/${RACE_ID}`, wrapper: createQueryWrapper() },
  );
const trackSource = () =>
  screen.getAllByTestId('maplibre-GeoJSONSource').find((node) => node.props.id === 'my-track');

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
  process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
  jest.mocked(api.getRace).mockResolvedValue(corridorRace({ distanceKm: 62 }));
  getRaceRoute.mockResolvedValue(route);
  jest.mocked(api.getRaceResults).mockResolvedValue(resultsPage());
  getMyRaceEntry.mockResolvedValue(myEntry({ attempts: [rejectedOff] }));
  getMyAttemptTrack.mockResolvedValue(track());
  jest.mocked(api.getMyRaceDisputes).mockResolvedValue(myDisputes());
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
  delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('свой трек на карте гонки (maps-02)', () => {
  it('гость — запроса трека нет, карта как в maps-01 (AC8)', async () => {
    await renderRouter(appRoutes, { initialUrl: `/races/${RACE_ID}` });
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    expect(getMyAttemptTrack).not.toHaveBeenCalled();
    expect(trackSource()).toBeUndefined();
  });

  it('не заявлен — запроса трека нет', async () => {
    signedIn();
    getMyRaceEntry.mockResolvedValue(noEntry());
    await openSignedIn();
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    expect(getMyAttemptTrack).not.toHaveBeenCalled();
  });

  it('участник с попыткой: трек со сходом, легенда, строки и подпись a11y карты (AC5, AC7)', async () => {
    signedIn();
    await openSignedIn();
    const summary = 'Вне коридора 820 м, самый длинный выход 640 м';
    expect(await screen.findByText(summary)).toBeOnTheScreen();
    expect(getMyAttemptTrack).toHaveBeenCalledWith(liveSession.accessToken, RACE_ID, BEST);
    const source = trackSource()!;
    expect(
      source.props.data.features.map((f: { properties: { kind: string } }) => f.properties.kind),
    ).toEqual(['outside', 'outside', 'segment', 'off']);
    const trackLayers = screen
      .getAllByTestId('maplibre-Layer')
      .filter((layer) => layer.props.source === 'my-track');
    expect(trackLayers.map((layer) => [layer.props.id, layer.props.beforeId])).toEqual([
      ['track-outside', 'start'],
      ['track', 'start'],
      ['track-off', 'start'],
    ]);
    expect(screen.getByText('Ваш трек · Вне коридора — пунктир')).toBeOnTheScreen();
    expect(screen.getByText('Где сход — пунктиром на карте')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(new RegExp(`^${mapLabel}\\. Ваш трек: ${summary}`)),
    ).toBeOnTheScreen();
    // камера — по рамке маршрута и трека
    expect(screen.getByTestId('maplibre-Camera').props.initialViewState.bounds).toEqual([
      27.49, 53.79, 27.61, 54.01,
    ]);
  });

  it('несколько попыток: по умолчанию лучшая; выбор другой — новый трек и строка (AC6)', async () => {
    signedIn();
    getMyRaceEntry.mockResolvedValue(myEntry({ attempts: [rejectedOff, counted] }));
    getMyAttemptTrack.mockImplementation(async (_token, _race, id) =>
      track({ attemptId: id, offRuns: id === OTHER ? [] : track().offRuns }),
    );
    await openSignedIn();
    expect(await screen.findByText('Весь сегмент в коридоре')).toBeOnTheScreen();
    expect(getMyAttemptTrack).toHaveBeenLastCalledWith(liveSession.accessToken, RACE_ID, OTHER);
    expect(screen.getByLabelText('Попытка на карте')).toBeOnTheScreen();
    await act(async () =>
      fireEvent.press(within(screen.getByTestId('my-track-attempts')).getByText(/Не засчитано/)),
    );
    expect(
      await screen.findByText('Вне коридора 820 м, самый длинный выход 640 м'),
    ).toBeOnTheScreen();
    expect(getMyAttemptTrack).toHaveBeenLastCalledWith(liveSession.accessToken, RACE_ID, BEST);
    expect(screen.queryByText('Весь сегмент в коридоре')).toBeNull();
    // новая карта смонтирована (загрузчик native — промис) до конца теста
    await waitFor(() => expect(trackSource()).toBeDefined());
  });

  it('проверка идёт — трек без подсветки и «проверяется» (AC7)', async () => {
    signedIn();
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        attempts: [attempt({ id: BEST, status: 'checking', segment: null, checkedAt: null })],
      }),
    );
    getMyAttemptTrack.mockResolvedValue(track({ segment: null, offRuns: [], marks: 'pending' }));
    await openSignedIn();
    expect(
      await screen.findByText('Трек проверяется — участки вне коридора появятся после проверки'),
    ).toBeOnTheScreen();
    expect(
      trackSource()!.props.data.features.map(
        (f: { properties: { kind: string } }) => f.properties.kind,
      ),
    ).toEqual(['segment']);
  });

  it('ошибка трека — карта маршрута остаётся, строка с повтором (AC8); 404 — без строки', async () => {
    signedIn();
    getMyAttemptTrack.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSignedIn();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(await screen.findByText('Не удалось загрузить трек')).toBeOnTheScreen();
    expect(screen.getByTestId('maplibre-Map')).toBeOnTheScreen();
    expect(trackSource()).toBeUndefined();
    getMyAttemptTrack.mockResolvedValue(track());
    await act(async () =>
      fireEvent.press(within(screen.getByTestId('my-track-error')).getByText('Повторить')),
    );
    await waitFor(() => expect(trackSource()).toBeDefined());
    expect(screen.queryByText('Не удалось загрузить трек')).toBeNull();
  });

  it('404 трека (старый API, активность удалена) — карта без трека и без строки ошибки (RC-8)', async () => {
    signedIn();
    getMyAttemptTrack.mockRejectedValue(
      new ApiHttpError(404, { code: 'NOT_FOUND', message: 'Не найдено' }),
    );
    await openSignedIn();
    expect(await screen.findByLabelText(mapLabel)).toBeOnTheScreen();
    expect(trackSource()).toBeUndefined();
    expect(screen.queryByText('Не удалось загрузить трек')).toBeNull();
  });
});
