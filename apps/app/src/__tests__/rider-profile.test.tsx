/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { PublicRiderProfile, PublicRiderRace } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { RiderScreen } from '@/features/riders/rider-screen';
import { api } from '@/lib/api';

import RiderRoute from '../app/riders/[id]';
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
