/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type {
  PublicRiderProfile,
  PublicRiderRace,
  RideCard,
  RiderSocial,
} from '@pokatim/contracts';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { Text, type RefreshControlProps } from 'react-native';

import { takeReturnPath } from '@/features/auth/return-path';
import { useSessionStore } from '@/features/auth/session-store';
import { useReportRider } from '@/features/riders/queries';
import { RiderScreen } from '@/features/riders/rider-screen';
import { api } from '@/lib/api';

import RiderRoute from '../app/riders/[id]';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const PUBLIC_ID = 'r'.repeat(43);
const RACE_ID = '0190a6f4-0000-7000-8000-000000000401';
const RACE_2 = '0190a6f4-0000-7000-8000-000000000402';

const rider: PublicRiderProfile = {
  publicId: PUBLIC_ID,
  name: 'Анна К.',
  club: 'Velo Club Minsk',
  avatar: null,
  stats: { races: 4, podiums: 2, bestPlace: 1, finishes: 5 },
};
const race = (id = RACE_ID, title = 'Гонка у озера'): PublicRiderRace => ({
  race: { id, title, windowStartsAt: '2026-05-01T06:00:00.000Z' },
  place: 3,
  tied: false,
  status: 'final',
  groupKey: 'w_u40',
  elapsedSec: 3600,
  unranked: null,
});
const notFound = () => new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' });
const noSocial: RiderSocial = {
  self: false,
  connected: false,
  together: { rideCount: 0, lastRideAt: null },
  going: null,
};

const getRider = jest.mocked(api.getRider);
const listRaces = jest.mocked(api.listRiderRaces);

const stub = () => null;
const openRider = (id: string = PUBLIC_ID) =>
  renderRouter(
    { 'riders/[id]': RiderRoute, 'races/[id]': stub, index: stub },
    { initialUrl: `/riders/${id}`, wrapper: createQueryWrapper() },
  );
const races = () => within(screen.getByTestId('rider-races'));

beforeEach(() => {
  useSessionStore.setState({ status: 'signedOut', session: null });
  getRider.mockResolvedValue(rider);
  listRaces.mockResolvedValue({ items: [race()], nextCursor: null });
  // блок достижений — пусто, блока нет (сам блок — `achievements-blocks.test.tsx`)
  jest.mocked(api.getRiderAchievements).mockResolvedValue({ items: [] });
  // «Свои» (P3) — пустое состояние: только «В свои»
  jest.mocked(api.getRiderSocial).mockResolvedValue(noSocial);
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('публичный профиль /riders/[id] (rider-profile, AC15)', () => {
  it('финиш без места (rider-links-in-tables) — «—», «Финишёр» и время', async () => {
    listRaces.mockResolvedValue({
      items: [{ ...race(RACE_2, 'START-гонка'), place: null, unranked: 'start' }],
      nextCursor: null,
    });
    await openRider();

    expect(await screen.findByText('START-гонка')).toBeOnTheScreen();
    expect(races().getByText('Финишёр')).toBeOnTheScreen();
    expect(races().queryByText('Финальный')).toBeNull();
    expect(races().getByText('—')).toBeOnTheScreen();
  });

  it('гость: имя, клуб, статистика без км, гонки; без userId и км в разметке', async () => {
    await openRider();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    expect(screen.getByText('Velo Club Minsk')).toBeOnTheScreen();
    expect(screen.getByLabelText('В зачёте 4')).toBeOnTheScreen();
    expect(screen.getByLabelText('Финиши 5')).toBeOnTheScreen();
    expect(screen.getByLabelText('Подиумы 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Лучшее место 1')).toBeOnTheScreen();
    expect(screen.queryByText(/км/)).toBeNull();
    expect(screen.queryByText('Дистанция')).toBeNull();

    expect(await races().findByText('Гонка у озера')).toBeOnTheScreen();
    expect(races().getByText('Финальный')).toBeOnTheScreen();
    expect(races().getByText('1:00:00')).toBeOnTheScreen();
    expect(races().getByText('Женщины до 40')).toBeOnTheScreen();
    expect(getRider).toHaveBeenCalledWith(PUBLIC_ID);
    expect(listRaces).toHaveBeenCalledWith(PUBLIC_ID, { limit: 10 });
  });

  it('строка гонки → /races/<id>', async () => {
    const router = await openRider();
    await fireEvent.press(await screen.findByRole('button', { name: /^Гонка у озера, / }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
  });

  it('невалидный id — «Профиль недоступен» без запроса', async () => {
    await openRider('not-a-token');
    expect(await screen.findByText('Профиль недоступен')).toBeOnTheScreen();
    expect(screen.getByText('Райдер скрыл профиль или ссылка устарела')).toBeOnTheScreen();
    expect(getRider).not.toHaveBeenCalled();
    expect(listRaces).not.toHaveBeenCalled();
  });

  it('404 (скрыл профиль, ссылка устарела) — «Профиль недоступен», гонки не запрашиваются; «На главную»', async () => {
    getRider.mockRejectedValue(notFound());
    const router = await openRider();
    expect(await screen.findByText('Профиль недоступен')).toBeOnTheScreen();
    expect(listRaces).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'На главную' }));
    await waitFor(() => expect(router.getPathname()).toBe('/'));
  });

  it('показанный профиль, затем 404 (райдер скрыл профиль) — «Профиль недоступен», данные убраны', async () => {
    await openRider();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    getRider.mockRejectedValue(notFound());
    const control = screen.getByTestId('rider-profile').props
      .refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      await control.props.onRefresh?.();
    });
    expect(await screen.findByText('Профиль недоступен')).toBeOnTheScreen();
    expect(screen.queryByText('Анна К.')).toBeNull();
    expect(screen.queryByText('Velo Club Minsk')).toBeNull();
  });

  it('нет сети — «Нет соединения» с повтором', async () => {
    getRider.mockRejectedValueOnce(new ApiNetworkError(new TypeError('Network request failed')));
    await openRider();
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
  });

  it('пусто — «Пока нет опубликованных результатов»', async () => {
    listRaces.mockResolvedValue({ items: [], nextCursor: null });
    await openRider();
    expect(await screen.findByText('Пока нет опубликованных результатов')).toBeOnTheScreen();
  });

  it('«Показать ещё» — следующая страница по курсору', async () => {
    listRaces
      .mockResolvedValueOnce({ items: [race()], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [race(RACE_2, 'Кубок осени')], nextCursor: null });
    await openRider();
    await fireEvent.press(await screen.findByRole('button', { name: 'Показать ещё' }));
    expect(await races().findByText('Кубок осени')).toBeOnTheScreen();
    expect(listRaces).toHaveBeenLastCalledWith(PUBLIC_ID, { limit: 10, cursor: 'c1' });
  });

  it('курсор устарел (400: строка выпала из новой ревизии протокола) — список с первой страницы, без ошибки', async () => {
    listRaces
      .mockResolvedValueOnce({ items: [race()], nextCursor: 'c1' })
      .mockRejectedValueOnce(new ApiHttpError(400, { code: 'VALIDATION_FAILED', message: 'x' }))
      .mockResolvedValueOnce({ items: [race(RACE_2, 'Кубок осени')], nextCursor: null });
    await openRider();
    await fireEvent.press(await screen.findByRole('button', { name: 'Показать ещё' }));
    expect(await races().findByText('Кубок осени')).toBeOnTheScreen();
    expect(listRaces).toHaveBeenLastCalledWith(PUBLIC_ID, { limit: 10 });
    expect(races().queryByText('Не удалось загрузить')).toBeNull();
  });

  it('посев SSR (web) — профиль сразу, без запроса профиля', async () => {
    await renderRouter(
      { 'riders/[id]': () => <RiderScreen id={PUBLIC_ID} seed={rider} /> },
      { initialUrl: `/riders/${PUBLIC_ID}`, wrapper: createQueryWrapper() },
    );
    expect(screen.getByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    expect(getRider).not.toHaveBeenCalled();
    await waitFor(() => expect(listRaces).toHaveBeenCalled());
  });
});

describe('«Пожаловаться» на публичном профиле (profile-report-app)', () => {
  const getViewer = jest.mocked(api.getRiderViewer);
  const report = jest.mocked(api.reportRider);
  const openWithReport = () =>
    renderRouter(
      {
        'riders/[id]': RiderRoute,
        'riders/report/[id]': () => <Text>Экран жалобы</Text>,
        'sign-in': () => <Text>Вход</Text>,
        index: stub,
      },
      { initialUrl: `/riders/${PUBLIC_ID}`, wrapper: createQueryWrapper() },
    );
  const signIn = () => useSessionStore.setState({ status: 'signedIn', session: liveSession });

  beforeEach(() => {
    getViewer.mockResolvedValue({ canReport: true, reported: false });
    takeReturnPath();
  });

  it('вошедший: «Пожаловаться» по canReport → экран жалобы', async () => {
    signIn();
    const router = await openWithReport();
    await fireEvent.press(await screen.findByRole('button', { name: 'Пожаловаться' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/riders/report/${PUBLIC_ID}`));
    expect(getViewer).toHaveBeenCalledWith(liveSession.accessToken, PUBLIC_ID);
  });

  it('вошедший, уже жаловался — «Вы пожаловались на этот профиль», без кнопки', async () => {
    signIn();
    getViewer.mockResolvedValue({ canReport: false, reported: true });
    await openWithReport();
    expect(await screen.findByText('Вы пожаловались на этот профиль')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Пожаловаться' })).toBeNull();
  });

  it('свой профиль (canReport false) — ни кнопки, ни строки', async () => {
    signIn();
    getViewer.mockResolvedValue({ canReport: false, reported: false });
    await openWithReport();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await waitFor(() => expect(getViewer).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Пожаловаться' })).toBeNull();
    expect(screen.queryByText('Вы пожаловались на этот профиль')).toBeNull();
  });

  it('ошибка me — повтор на месте блока, профиль остаётся', async () => {
    signIn();
    getViewer.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openWithReport();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('button', { name: 'Пожаловаться' })).toBeOnTheScreen();
  });

  it('жалоба отправлена — кнопка сменяется строкой из кеша зрителя, без перезапроса', async () => {
    signIn();
    report.mockResolvedValue({ canReport: false, reported: true });
    let send: (() => Promise<unknown>) | undefined;
    const Sender = () => {
      const mutation = useReportRider(PUBLIC_ID);
      send = () => mutation.mutateAsync({ reason: 'photo', comment: null });
      return null;
    };
    await renderRouter(
      {
        'riders/[id]': () => (
          <>
            <RiderRoute />
            <Sender />
          </>
        ),
        index: stub,
      },
      { initialUrl: `/riders/${PUBLIC_ID}`, wrapper: createQueryWrapper() },
    );
    expect(await screen.findByRole('button', { name: 'Пожаловаться' })).toBeOnTheScreen();
    await act(async () => {
      await send?.();
    });
    expect(await screen.findByText('Вы пожаловались на этот профиль')).toBeOnTheScreen();
    expect(getViewer).toHaveBeenCalledTimes(1);
  });

  it('гость: «Пожаловаться» → «Вход», путь возврата — профиль; запроса me нет', async () => {
    const router = await openWithReport();
    await fireEvent.press(await screen.findByRole('button', { name: 'Пожаловаться' }));
    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'));
    expect(takeReturnPath()).toBe(`/riders/${PUBLIC_ID}`);
    expect(getViewer).not.toHaveBeenCalled();
  });

  it('сессия неизвестна (SSR, восстановление) — блока нет', async () => {
    useSessionStore.setState({ status: 'unknown', session: null });
    await openWithReport();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Пожаловаться' })).toBeNull();
    expect(getViewer).not.toHaveBeenCalled();
  });
});

describe('«Свои» на чужом профиле (P3, K6)', () => {
  const RIDE_ID = '0190a6f4-0000-7000-8000-000000000501';
  const getSocial = jest.mocked(api.getRiderSocial);
  const setConnection = jest.mocked(api.setRiderConnection);
  const joinRide = jest.mocked(api.joinRide);
  const ride: RideCard = {
    id: RIDE_ID,
    title: 'Кофе на Минском море',
    organizerName: null,
    startsAt: '2026-11-07T07:00:00Z',
    city: 'minsk',
    place: 'Парк Победы',
    distanceKm: 42,
    paceMinKmh: 22,
    paceMaxKmh: 24,
    limit: 12,
    goingCount: 5,
    full: false,
    phase: 'upcoming',
    cancelReason: null,
    rescheduledAt: null,
    route: null,
    start: null,
    photo: null,
    viewer: {
      role: 'none',
      canJoin: true,
      canLeave: false,
      canManage: false,
      reported: false,
      canReport: true,
    },
  };
  const together = { rideCount: 3, lastRideAt: '2026-10-10T07:00:00Z' };
  const openSocial = () =>
    renderRouter(
      {
        'riders/[id]': RiderRoute,
        'rides/[id]': () => <Text>Райд</Text>,
        'sign-in': () => <Text>Вход</Text>,
        index: stub,
      },
      { initialUrl: `/riders/${PUBLIC_ID}`, wrapper: createQueryWrapper() },
    );
  const signIn = () => useSessionStore.setState({ status: 'signedIn', session: liveSession });

  beforeEach(() => {
    jest.mocked(api.getRiderViewer).mockResolvedValue({ canReport: true, reported: false });
    takeReturnPath();
    jest.useFakeTimers({
      now: new Date('2026-10-31T10:00:00Z'),
      doNotFake: ['nextTick', 'setImmediate'],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('«Вместе ехали 3 раза · последний — 10 октября» при N > 0; при 0 — строки нет', async () => {
    signIn();
    getSocial.mockResolvedValue({ ...noSocial, together });
    await openSocial();
    expect(
      await screen.findByText('Вместе ехали 3 раза · последний — 10 октября'),
    ).toBeOnTheScreen();
    expect(getSocial).toHaveBeenCalledWith(liveSession.accessToken, PUBLIC_ID);
  });

  it('N = 0 — строки «Вместе ехали» нет, есть «В свои»', async () => {
    signIn();
    await openSocial();
    expect(await screen.findByRole('button', { name: 'В свои' })).toBeOnTheScreen();
    expect(screen.queryByText(/Вместе ехали/)).toBeNull();
  });

  it('«Идёт»: строка райда ведёт на райд; «Я иду» → POST join, затем «Вы идёте» (перезапрос social)', async () => {
    signIn();
    getSocial.mockResolvedValue({ ...noSocial, connected: true, together, going: ride });
    const router = await openSocial();
    const going = within(await screen.findByTestId('rider-social-going'));
    expect(going.getByText('Идёт')).toBeOnTheScreen();
    expect(going.getByText('Кофе на Минском море')).toBeOnTheScreen();

    joinRide.mockResolvedValue({
      ride: { ...ride, goingCount: 6, description: null },
      viewer: { ...ride.viewer, role: 'participant', canJoin: false, canLeave: true },
    });
    getSocial.mockResolvedValue({
      ...noSocial,
      connected: true,
      together,
      going: {
        ...ride,
        goingCount: 6,
        viewer: { ...ride.viewer, role: 'participant', canJoin: false, canLeave: true },
      },
    });
    await fireEvent.press(going.getByRole('button', { name: 'Я иду' }));
    expect(joinRide).toHaveBeenCalledWith(liveSession.accessToken, RIDE_ID, 'profile');
    expect(await screen.findByText('Вы идёте')).toBeOnTheScreen();
    expect(getSocial).toHaveBeenCalledTimes(2);

    await fireEvent.press(screen.getByRole('link', { name: /Кофе на Минском море/ }));
    await waitFor(() => expect(router.getPathname()).toBe(`/rides/${RIDE_ID}`));
  });

  it('«В свои» → PUT connected:true → «В своих»; повтор → connected:false', async () => {
    signIn();
    setConnection.mockResolvedValueOnce({ ...noSocial, connected: true });
    await openSocial();
    await fireEvent.press(await screen.findByRole('button', { name: 'В свои' }));
    expect(setConnection).toHaveBeenCalledWith(liveSession.accessToken, PUBLIC_ID, {
      connected: true,
    });
    expect(await screen.findByRole('button', { name: 'В своих' })).toBeOnTheScreen();

    setConnection.mockResolvedValueOnce(noSocial);
    await fireEvent.press(screen.getByRole('button', { name: 'В своих' }));
    expect(setConnection).toHaveBeenLastCalledWith(liveSession.accessToken, PUBLIC_ID, {
      connected: false,
    });
    expect(await screen.findByRole('button', { name: 'В свои' })).toBeOnTheScreen();
  });

  it('429 — текст у кнопки, состояние не меняется', async () => {
    signIn();
    setConnection.mockRejectedValueOnce(
      new ApiHttpError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSec: 60 } }),
    );
    await openSocial();
    await fireEvent.press(await screen.findByRole('button', { name: 'В свои' }));
    expect(await screen.findByText('Слишком много действий, попробуйте позже')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'В свои' })).toBeOnTheScreen();
  });

  it('свой профиль (self) — блока нет', async () => {
    signIn();
    getSocial.mockResolvedValue({ ...noSocial, self: true });
    await openSocial();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await waitFor(() => expect(getSocial).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'В свои' })).toBeNull();
    expect(screen.queryByTestId('rider-social')).toBeNull();
  });

  it('гость — только «В свои» → «Вход» с возвратом на профиль; запроса social нет', async () => {
    const router = await openSocial();
    await fireEvent.press(await screen.findByRole('button', { name: 'В свои' }));
    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'));
    expect(takeReturnPath()).toBe(`/riders/${PUBLIC_ID}`);
    expect(getSocial).not.toHaveBeenCalled();
    expect(screen.queryByText(/Вместе ехали/)).toBeNull();
  });

  it('первая загрузка — скелетон на месте блока', async () => {
    signIn();
    getSocial.mockReturnValue(new Promise(() => undefined));
    await openSocial();
    expect(
      await screen.findByTestId('rider-social-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
  });

  it('ошибка блока — «Не удалось загрузить» с повтором, профиль виден', async () => {
    signIn();
    getSocial.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSocial();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('button', { name: 'В свои' })).toBeOnTheScreen();
  });
});
