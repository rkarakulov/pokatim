/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDocumentAsync } from 'expo-document-picker';
import { AccessibilityInfo } from 'react-native';

import { takeReturnPath } from '@/features/auth/return-path';
import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import RacePickRoute from '../app/races/pick/[id]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { upload } from './devices-fixtures';
import { FakeXhr } from './fake-xhr';
import { myDisputes } from './disputes-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  actions,
  attempt,
  corridorRace,
  myEntry,
  noEntry,
  RACE_ID,
  result,
  resultsPage,
  row,
  UPLOAD_ID,
} from './races-fixtures';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

const getRace = jest.mocked(api.getRace);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);
const enterRace = jest.mocked(api.enterRace);
const withdrawFromRace = jest.mocked(api.withdrawFromRace);
const addRaceAttempt = jest.mocked(api.addRaceAttempt);
const getRaceResults = jest.mocked(api.getRaceResults);
const pick = jest.mocked(getDocumentAsync);

/** «Сейчас»: 8 октября 2026, 21:00 по Минску — окно гонки открыто. */
const NOW = new Date('2026-10-08T18:00:00Z');
const TOKEN = liveSession.accessToken;
const never = () => new Promise<never>(() => undefined);
const conflict = (code: string) => new ApiHttpError(409, { code, message: 'x' });

/** Ответ сервера после отмены участия. */
const withdrawnEntry = () =>
  myEntry({
    entry: { ...myEntry().entry!, status: 'withdrawn', withdrawnAt: NOW.toISOString() },
    result: result({ status: 'withdrawn' }),
    actions: actions({ reasons: ['withdrawn'] }),
  });

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};

const signedInRoutes = {
  ...tabRoutes,
  'races/[id]': RaceRoute,
  'races/pick/[id]': RacePickRoute,
};

const openSignedIn = () =>
  renderRouter(signedInRoutes, {
    initialUrl: `/races/${RACE_ID}`,
    wrapper: createQueryWrapper(),
  });

const participation = () => within(screen.getByTestId('race-participation'));
const realXhr = global.XMLHttpRequest;
const realFetch = global.fetch;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRace.mockResolvedValue(corridorRace());
  getMyRaceEntry.mockResolvedValue(noEntry());
  getRaceResults.mockResolvedValue(resultsPage());
  // споры (race-results-06): у участника — запрос «моих споров»; здесь их нет
  jest.mocked(api.getMyRaceDisputes).mockResolvedValue(myDisputes());
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(api.trackUploadRequest).mockReturnValue({
    url: 'https://api.example/v1/tracks/uploads?name=ride.gpx',
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' },
  });
  FakeXhr.last = undefined;
  global.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  global.fetch = jest.fn(async () => ({ blob: async () => ({ size: 1024 }) })) as never;
});
afterEach(() => {
  global.XMLHttpRequest = realXhr;
  global.fetch = realFetch;
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

describe('гость (AC1)', () => {
  it.each(['upcoming', 'open'] as const)(
    'коридор, фаза %s — «Участвовать» → вход с возвратом к гонке',
    async (phase) => {
      getRace.mockResolvedValue(corridorRace({ phase }));
      const router = await renderRouter(appRoutes, { initialUrl: `/races/${RACE_ID}` });

      expect(await screen.findByText('Войдите, чтобы участвовать')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Участвовать' }));
      expect(await screen.findByRole('header', { name: 'Вход' })).toBeOnTheScreen();
      expect(router.getPathname()).toBe('/sign-in');
      expect(takeReturnPath()).toBe(`/races/${RACE_ID}`);
      expect(getMyRaceEntry).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['без коридора', corridorRace({ corridor: null })],
    ['закрыта', corridorRace({ phase: 'closed' })],
    ['отменена', corridorRace({ phase: 'cancelled' })],
  ])('%s — блока нет', async (_case, race) => {
    getRace.mockResolvedValue(race);
    await renderRouter(appRoutes, { initialUrl: `/races/${RACE_ID}` });

    expect(
      await screen.findByRole('header', { name: 'Гравийный коридор Логойск' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Участвовать' })).toBeNull();
    expect(screen.queryByText('Войдите, чтобы участвовать')).toBeNull();
    expect(getMyRaceEntry).not.toHaveBeenCalled();
  });

  it('сессия ещё неизвестна — блока нет (F7)', async () => {
    useSessionStore.setState({ status: 'unknown', session: null });
    await renderRouter(
      { 'races/[id]': RaceRoute },
      { initialUrl: `/races/${RACE_ID}`, wrapper: createQueryWrapper() },
    );

    expect(
      await screen.findByRole('header', { name: 'Гравийный коридор Логойск' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Участвовать' })).toBeNull();
    expect(screen.queryByTestId('race-participation')).toBeNull();
  });
});

describe('вошедший: заявка (AC2, AC3, AC15, AC16)', () => {
  beforeEach(signedIn);

  it('«Участвовать» → enterRace, кнопка занята в процессе, затем — активная заявка', async () => {
    let resolve: (value: ReturnType<typeof myEntry>) => void = () => undefined;
    enterRace.mockReturnValue(new Promise((r) => (resolve = r)));
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать' }));
    expect(enterRace).toHaveBeenCalledWith(TOKEN, RACE_ID);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Участвовать' })).toBeDisabled());

    await act(async () => resolve(myEntry()));
    expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();
    expect(participation().getByText('Нет заездов')).toBeOnTheScreen();
    expect(participation().getByRole('button', { name: 'Загрузить заезд' })).toBeOnTheScreen();
    expect(participation().getByRole('button', { name: 'Выбрать свой заезд' })).toBeOnTheScreen();
    expect(
      participation().getByText('Загрузить заезд можно до 12 октября, 23:59'),
    ).toBeOnTheScreen();
    expect(participation().getByRole('button', { name: 'Отменить участие' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Участвовать' })).toBeNull();
  });

  it('без canEnter — причина заявки (не not_entered)', async () => {
    getMyRaceEntry.mockResolvedValue(
      noEntry({ actions: actions({ reasons: ['entries_closed', 'not_entered'] }) }),
    );
    await openSignedIn();

    expect(await screen.findByText('Приём заявок закрыт')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Участвовать' })).toBeNull();
  });

  it('отменённая гонка без заявки — блока нет (баннер отмены уже есть, F8)', async () => {
    getRace.mockResolvedValue(corridorRace({ phase: 'cancelled' }));
    getMyRaceEntry.mockResolvedValue(
      noEntry({ actions: actions({ reasons: ['cancelled', 'not_entered'] }) }),
    );
    await openSignedIn();

    expect(await screen.findByText('Гонка отменена.')).toBeOnTheScreen();
    await waitFor(() => expect(getMyRaceEntry).toHaveBeenCalled());
    expect(screen.queryByText('Гонка отменена')).toBeNull();
    expect(screen.queryByTestId('race-participation')).toBeNull();
  });

  it('409 RACE_ENTRY_CLOSED — текст у кнопки и участие перезапрошено', async () => {
    enterRace.mockRejectedValue(conflict('RACE_ENTRY_CLOSED'));
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать' }));
    expect(await screen.findByText('Приём заявок на гонку закрыт')).toBeOnTheScreen();
    await waitFor(() => expect(getMyRaceEntry).toHaveBeenCalledTimes(2));
  });

  it('ошибка участия — карточка видна, баннер и «Повторить»', async () => {
    getMyRaceEntry.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSignedIn();

    expect(await screen.findByText('Не удалось загрузить ваше участие')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Гравийный коридор Логойск' })).toBeOnTheScreen();
    await fireEvent.press(participation().getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Участвовать' })).toBeOnTheScreen();
  });

  it('404 участия (старый API) — блока нет', async () => {
    getMyRaceEntry.mockRejectedValue(new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' }));
    await openSignedIn();

    expect(
      await screen.findByRole('header', { name: 'Гравийный коридор Логойск' }),
    ).toBeOnTheScreen();
    await waitFor(() => expect(getMyRaceEntry).toHaveBeenCalled());
    expect(screen.queryByTestId('race-participation')).toBeNull();
  });

  it('участие отменено — баннер без действий', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        entry: { ...myEntry().entry!, status: 'withdrawn', withdrawnAt: NOW.toISOString() },
        result: result({ status: 'withdrawn' }),
        actions: actions({ reasons: ['withdrawn'] }),
      }),
    );
    await openSignedIn();

    expect(await screen.findByText('Участие отменено')).toBeOnTheScreen();
    expect(screen.getByText('Вы отменили участие в этой гонке')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Загрузить заезд' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить участие' })).toBeNull();
  });
});

describe('вошедший: результат и попытки (AC4, AC5)', () => {
  beforeEach(signedIn);

  it('pending — «Проверка трека», «Место появится после проверки.», без «Ваше время»', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'pending' }),
        attempts: [attempt({ status: 'checking', segment: null, isBest: false })],
      }),
    );
    await openSignedIn();

    expect(await screen.findByText('Место появится после проверки.')).toBeOnTheScreen();
    expect(participation().getAllByText('Проверка трека').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ваше время')).toBeNull();
  });

  it('provisional с местом: время, плашка, место до даты протокола', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'provisional', elapsedSec: 6125, place: 3, ranked: 10 }),
        attempts: [attempt()],
      }),
    );
    await openSignedIn();

    expect(await screen.findByText('Ваше время')).toBeOnTheScreen();
    expect(participation().getAllByText('1:42:05').length).toBeGreaterThan(0);
    expect(participation().getByText('Предварительный')).toBeOnTheScreen();
    expect(
      screen.getByText('Предварительно 3-е место до публикации протокола 14 октября.'),
    ).toBeOnTheScreen();
    // попытки есть — «Загрузить ещё заезд»
    expect(participation().getByRole('button', { name: 'Загрузить ещё заезд' })).toBeOnTheScreen();
  });

  it('provisional: ничья', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'provisional', elapsedSec: 6125, place: 2, tied: true }),
      }),
    );
    await openSignedIn();
    expect(
      await screen.findByText(
        'Предварительно 2-е место (поровну с другими) до публикации протокола 14 октября.',
      ),
    ).toBeOnTheScreen();
  });

  it('provisional без места — примечание', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({ result: result({ status: 'provisional', elapsedSec: 6125 }) }),
    );
    await openSignedIn();
    expect(
      await screen.findByText('Результат предварительный до публикации протокола 14 октября.'),
    ).toBeOnTheScreen();
  });

  it('попытки: статус, «Лучший», причина отказа, подсказка сбоя; незавершённые загрузки', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'provisional', elapsedSec: 6125, place: 1 }),
        attempts: [
          attempt(),
          attempt({
            id: '0199d000-0000-7000-8000-0000000000b2',
            status: 'rejected',
            reasons: ['wrong_direction'],
            segment: null,
            isBest: false,
            origin: 'auto',
            activity: { ...attempt().activity, source: 'garmin' },
          }),
          attempt({
            id: '0199d000-0000-7000-8000-0000000000b3',
            status: 'failed',
            segment: null,
            isBest: false,
          }),
        ],
        pendingUploads: [
          { uploadId: UPLOAD_ID, status: 'failed', failure: 'no_track' },
          { uploadId: '0199c000-0000-7000-8000-000000000002', status: 'ready', failure: null },
        ],
      }),
    );
    await openSignedIn();

    expect(await screen.findByText('Лучший')).toBeOnTheScreen();
    expect(participation().getByText('Засчитано')).toBeOnTheScreen();
    expect(participation().getByText('Обратное направление')).toBeOnTheScreen();
    expect(participation().getByText(/Garmin · Из импорта/)).toBeOnTheScreen();
    expect(participation().getAllByText(/8 октября, 19:42/).length).toBe(3);
    expect(
      participation().getByText('Не удалось проверить трек — команда платформы разберётся.'),
    ).toBeOnTheScreen();
    expect(participation().getByText('Файл не принят: В файле нет трека')).toBeOnTheScreen();
    expect(participation().queryByText('Файл обрабатывается…')).toBeNull();
  });

  it('без canAddAttempt — причина попытки upload_closed, не window_closed (F1)', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        actions: actions({ reasons: ['window_closed', 'upload_closed'] }),
      }),
    );
    await openSignedIn();

    expect(await screen.findByText('Срок загрузки заездов истёк')).toBeOnTheScreen();
    expect(screen.queryByText('Окно закрыто')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Загрузить заезд' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить участие' })).toBeNull();
  });

  it('«Выбрать свой заезд» → /races/pick/<id>', async () => {
    getMyRaceEntry.mockResolvedValue(myEntry());
    jest.mocked(api.listAttemptCandidates).mockReturnValue(never());
    const router = await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Выбрать свой заезд' }));
    expect(router.getPathname()).toBe(`/races/pick/${RACE_ID}`);
  });
});

describe('polling — место появляется тихо (AC6)', () => {
  beforeEach(signedIn);

  it('проверка → опрос раз в 3 с; результат с местом → таблица перезапрошена, опрос остановлен', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'pending' }),
        attempts: [attempt({ status: 'checking', segment: null, isBest: false })],
      }),
    );
    await openSignedIn();
    expect(await screen.findByText('Место появится после проверки.')).toBeOnTheScreen();
    await waitFor(() => expect(getRaceResults).toHaveBeenCalledTimes(1));
    expect(getMyRaceEntry).toHaveBeenCalledTimes(1);

    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'provisional', elapsedSec: 6125, place: 1, ranked: 1 }),
        attempts: [attempt()],
      }),
    );
    getRaceResults.mockResolvedValue(
      resultsPage([row({ entryId: myEntry().entry!.id, elapsedSec: 6125 })]),
    );
    await act(() => jest.advanceTimersByTimeAsync(3000));
    expect(getMyRaceEntry).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText('Предварительно 1-е место до публикации протокола 14 октября.'),
    ).toBeOnTheScreen();
    await waitFor(() => expect(getRaceResults).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();

    await act(() => jest.advanceTimersByTimeAsync(10_000));
    expect(getMyRaceEntry).toHaveBeenCalledTimes(2);
  });

  it('ответ опроса, начатого до мутации, не затирает ответ мутации', async () => {
    const checking = myEntry({
      result: result({ status: 'pending' }),
      attempts: [attempt({ status: 'checking', segment: null, isBest: false })],
    });
    getMyRaceEntry.mockResolvedValue(checking);
    await openSignedIn();
    expect(await screen.findByText('Место появится после проверки.')).toBeOnTheScreen();

    // опрос уходит и висит
    let finishPoll: () => void = () => undefined;
    getMyRaceEntry.mockReturnValueOnce(
      new Promise((resolve) => {
        finishPoll = () => resolve(checking);
      }),
    );
    await act(() => jest.advanceTimersByTimeAsync(3000));
    expect(getMyRaceEntry).toHaveBeenCalledTimes(2);

    withdrawFromRace.mockResolvedValue(withdrawnEntry());
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить участие' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить участие' }));
    expect(await screen.findByText('Участие отменено')).toBeOnTheScreen();

    // устаревший ответ опроса приходит после мутации
    await act(async () => finishPoll());
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Участие отменено')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отменить участие' })).toBeNull();
  });

  it('всё проверено — без опроса', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({ result: result({ status: 'provisional', elapsedSec: 1, place: 1 }) }),
    );
    await openSignedIn();
    await screen.findByText('Ваше время');

    await act(() => jest.advanceTimersByTimeAsync(10_000));
    expect(getMyRaceEntry).toHaveBeenCalledTimes(1);
  });
});

describe('загрузка заезда в гонку (AC7)', () => {
  beforeEach(() => {
    signedIn();
    getMyRaceEntry.mockResolvedValue(myEntry());
  });

  const picked = (name: string, size: number) =>
    pick.mockResolvedValue({
      canceled: false,
      assets: [{ name, size, uri: `file:///cache/${name}`, lastModified: 0 }],
    });

  it('файл → загрузка → addRaceAttempt({ uploadId }) → участие из ответа', async () => {
    picked('ride.gpx', 1024);
    addRaceAttempt.mockResolvedValue(
      myEntry({
        attempts: [attempt({ status: 'queued', segment: null, isBest: false })],
        result: result({ status: 'pending' }),
      }),
    );
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить заезд' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await act(async () => FakeXhr.last?.progress(42, 100));
    expect(screen.getByText('Загружаем ride.gpx: 42%')).toBeOnTheScreen();

    await act(async () => FakeXhr.last?.respond(202, upload({ status: 'queued', activity: null })));
    await waitFor(() =>
      expect(addRaceAttempt).toHaveBeenCalledWith(TOKEN, RACE_ID, { uploadId: UPLOAD_ID }),
    );
    expect(await screen.findByText('В очереди на проверку')).toBeOnTheScreen();
    expect(screen.getByText('Место появится после проверки.')).toBeOnTheScreen();
  });

  it('срок загрузки истёк посреди отправки — прогресс и «Отменить» остаются', async () => {
    getMyRaceEntry.mockResolvedValue(myEntry({ result: result({ status: 'pending' }) }));
    picked('ride.gpx', 1024);
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить заезд' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        result: result({ status: 'pending' }),
        actions: actions({ canWithdraw: true, reasons: ['upload_closed'] }),
      }),
    );
    await act(() => jest.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText('Срок загрузки заездов истёк')).toBeOnTheScreen();
    expect(screen.getByText('Загружаем ride.gpx: 0%')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить' }));
    expect(FakeXhr.last?.aborted).toBe(true);
  });

  it('отказ pre-check — баннер, запроса нет', async () => {
    picked('ride.tcx', 1024);
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить заезд' }));
    expect(await screen.findByText(/FIT или GPX/)).toBeOnTheScreen();
    expect(api.trackUploadRequest).not.toHaveBeenCalled();
    expect(addRaceAttempt).not.toHaveBeenCalled();
  });

  it('409 ATTEMPT_UPLOAD_CLOSED на втором шаге — баннер с текстом', async () => {
    picked('ride.gpx', 1024);
    addRaceAttempt.mockRejectedValue(conflict('ATTEMPT_UPLOAD_CLOSED'));
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить заезд' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await act(async () => FakeXhr.last?.respond(202, upload({ status: 'queued', activity: null })));
    expect(await screen.findByText('Срок загрузки заездов истёк')).toBeOnTheScreen();
  });

  it('«Отменить» прогресса — без попытки', async () => {
    picked('ride.gpx', 1024);
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Загрузить заезд' }));
    await waitFor(() => expect(FakeXhr.last).toBeDefined());
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить' }));
    expect(FakeXhr.last?.aborted).toBe(true);
    expect(await screen.findByRole('button', { name: 'Загрузить заезд' })).toBeOnTheScreen();
    expect(addRaceAttempt).not.toHaveBeenCalled();
  });
});

describe('споры: D-39 и DQ (race-results-06, AC12)', () => {
  beforeEach(signedIn);

  it('открыт спор по моему результату — причины у загрузки и отмены, кнопок нет', async () => {
    getMyRaceEntry.mockResolvedValue(myEntry({ actions: actions({ reasons: ['dispute_open'] }) }));
    await openSignedIn();

    expect(
      await screen.findByText(
        'По результату открыт спор — новые заезды можно загрузить после решения',
      ),
    ).toBeOnTheScreen();
    expect(
      participation().getByText('Отменить участие можно после решения по спору'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Загрузить заезд' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить участие' })).toBeNull();
  });

  it('DQ — причина у загрузки и отмены', async () => {
    getMyRaceEntry.mockResolvedValue(myEntry({ actions: actions({ reasons: ['disqualified'] }) }));
    await openSignedIn();

    expect(
      await screen.findAllByText('Результат дисквалифицирован по решению команды платформы'),
    ).toHaveLength(2);
  });

  it('409 RACE_WITHDRAW_CLOSED с dispute_open — текст по details.reason', async () => {
    getMyRaceEntry.mockResolvedValue(myEntry());
    withdrawFromRace.mockRejectedValue(
      new ApiHttpError(409, {
        code: 'RACE_WITHDRAW_CLOSED',
        message: 'x',
        details: { reason: 'dispute_open' },
      }),
    );
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить участие' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить участие' }));
    expect(
      await screen.findAllByText('Отменить участие можно после решения по спору'),
    ).not.toHaveLength(0);
  });
});

describe('отмена участия (AC9)', () => {
  beforeEach(() => {
    signedIn();
    getMyRaceEntry.mockResolvedValue(myEntry());
  });

  it('«Оставить участие» закрывает панель без запроса', async () => {
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить участие' }));
    expect(screen.getByText('Отменить участие?')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Ваш результат уйдёт из зачёта, места других участников пересчитаются. Заявиться на эту гонку снова будет нельзя.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Оставить участие' }));
    expect(screen.queryByText('Отменить участие?')).toBeNull();
    expect(withdrawFromRace).not.toHaveBeenCalled();
  });

  it('подтверждение → withdrawFromRace → блок «Участие отменено»', async () => {
    withdrawFromRace.mockResolvedValue(
      myEntry({
        entry: { ...myEntry().entry!, status: 'withdrawn', withdrawnAt: NOW.toISOString() },
        result: result({ status: 'withdrawn' }),
        actions: actions({ reasons: ['withdrawn'] }),
      }),
    );
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить участие' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить участие' }));
    expect(withdrawFromRace).toHaveBeenCalledWith(TOKEN, RACE_ID);
    expect(await screen.findByText('Участие отменено')).toBeOnTheScreen();
    expect(screen.queryByText('Отменить участие?')).toBeNull();
  });

  it('409 RACE_WITHDRAW_CLOSED — текст остаётся и после перезапроса с canWithdraw: false', async () => {
    withdrawFromRace.mockRejectedValue(conflict('RACE_WITHDRAW_CLOSED'));
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить участие' }));
    // так ответит сервер после закрытия окна: отмена и загрузка недоступны
    getMyRaceEntry.mockResolvedValue(
      myEntry({ actions: actions({ reasons: ['window_closed', 'upload_closed'] }) }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить участие' }));
    expect(await screen.findByText('Отменить участие можно, пока окно открыто')).toBeOnTheScreen();
    await waitFor(() => expect(getMyRaceEntry).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Срок загрузки заездов истёк')).toBeOnTheScreen();
    expect(screen.queryByText('Отменить участие?')).toBeNull();
    expect(screen.getByText('Отменить участие можно, пока окно открыто')).toBeOnTheScreen();
  });

  it('ошибка отмены уходит после «Оставить участие»', async () => {
    withdrawFromRace.mockRejectedValue(new ApiNetworkError(new TypeError('offline')));
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить участие' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отменить участие' }));
    await waitFor(() => expect(withdrawFromRace).toHaveBeenCalledTimes(1));
    await fireEvent.press(await screen.findByRole('button', { name: 'Оставить участие' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('подтверждение — фокус скринридера на заголовок', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await openSignedIn();

    await fireEvent.press(await screen.findByRole('button', { name: 'Отменить участие' }));
    await waitFor(() => expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus'));
    focus.mockRestore();
  });
});
