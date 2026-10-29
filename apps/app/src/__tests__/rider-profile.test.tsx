/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { PublicRiderProfile, PublicRiderRace } from '@pokatim/contracts';
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
  stats: { races: 4, podiums: 2, bestPlace: 1 },
};
const race = (id = RACE_ID, title = 'Гонка у озера'): PublicRiderRace => ({
  race: { id, title, windowStartsAt: '2026-05-01T06:00:00.000Z' },
  place: 3,
  tied: false,
  status: 'final',
  groupKey: 'w_u40',
  elapsedSec: 3600,
});
const notFound = () => new ApiHttpError(404, { code: 'NOT_FOUND', message: 'x' });

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
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('публичный профиль /riders/[id] (rider-profile, AC15)', () => {
  it('гость: имя, клуб, статистика без км, гонки; без userId и км в разметке', async () => {
    await openRider();
    expect(await screen.findByRole('header', { name: 'Анна К.' })).toBeOnTheScreen();
    expect(screen.getByText('Velo Club Minsk')).toBeOnTheScreen();
    expect(screen.getByLabelText('В зачёте 4')).toBeOnTheScreen();
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
