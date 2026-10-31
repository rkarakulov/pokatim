/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RiderSocial, SocialConnectionRow } from '@pokatim/contracts';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import SocialRoute from '../app/social';
import { liveSession, signInForTest } from './auth-fixtures';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';

jest.mock('@/lib/api');

const ANNA = 'a'.repeat(43);
const BORIS = 'b'.repeat(43);
const VERA = 'v'.repeat(43);

const row = (overrides: Partial<SocialConnectionRow>): SocialConnectionRow => ({
  publicId: ANNA,
  name: 'Анна К.',
  avatar: null,
  rideCount: 0,
  lastRideAt: null,
  sources: ['manual'],
  ...overrides,
});
const rows = [
  row({
    publicId: ANNA,
    name: 'Анна К.',
    rideCount: 3,
    lastRideAt: '2026-10-10T07:00:00Z',
    sources: ['ride'],
  }),
  row({ publicId: BORIS, name: 'Борис Л.', sources: ['manual', 'invite'] }),
  row({ publicId: VERA, name: 'Вера З.', sources: ['invite'] }),
];
const social = (connected: boolean): RiderSocial => ({
  self: false,
  connected,
  together: { rideCount: 0, lastRideAt: null },
  going: null,
});

const list = jest.mocked(api.listSocialConnections);
const setConnection = jest.mocked(api.setRiderConnection);

const openSocial = (client = createTestQueryClient()) =>
  renderRouter(
    {
      social: SocialRoute,
      'riders/[id]': () => <Text>Профиль райдера</Text>,
      profile: () => <Text>Профиль</Text>,
    },
    { initialUrl: '/social', wrapper: createQueryWrapper(client) },
  );
const rowOf = (publicId: string) => within(screen.getByTestId(`social-row-${publicId}`));

beforeEach(() => {
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  list.mockResolvedValue({ items: rows, count: rows.length });
  jest.useFakeTimers({
    now: new Date('2026-10-31T10:00:00Z'),
    doNotFake: ['nextTick', 'setImmediate'],
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('экран «Свои» /social (P3, K6)', () => {
  it('строки трёх видов текста: вместе N раз, «Добавлены вами», «По приглашению»', async () => {
    await openSocial();
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(rowOf(ANNA).getByText('Вместе 3 раза · последний — 10 октября')).toBeOnTheScreen();
    expect(rowOf(BORIS).getByText('Добавлены вами')).toBeOnTheScreen();
    expect(rowOf(VERA).getByText('По приглашению')).toBeOnTheScreen();
    expect(list).toHaveBeenCalledWith(liveSession.accessToken);
  });

  it('нажатие строки → /riders/<publicId>', async () => {
    const router = await openSocial();
    await fireEvent.press(await screen.findByRole('link', { name: /^Борис Л\./ }));
    await waitFor(() => expect(router.getPathname()).toBe(`/riders/${BORIS}`));
  });

  it('«В своих» → PUT false, строка остаётся с «В свои»; повтор → PUT true; список не перезапрашивается', async () => {
    setConnection.mockResolvedValueOnce(social(false));
    await openSocial();
    expect(await screen.findByText('Борис Л.')).toBeOnTheScreen();
    await fireEvent.press(rowOf(BORIS).getByRole('button', { name: 'В своих' }));
    expect(setConnection).toHaveBeenCalledWith(liveSession.accessToken, BORIS, {
      connected: false,
    });
    expect(await rowOf(BORIS).findByRole('button', { name: 'В свои' })).toBeOnTheScreen();
    expect(rowOf(BORIS).getByText('Борис Л.')).toBeOnTheScreen();

    setConnection.mockResolvedValueOnce(social(true));
    await fireEvent.press(rowOf(BORIS).getByRole('button', { name: 'В свои' }));
    expect(setConnection).toHaveBeenLastCalledWith(liveSession.accessToken, BORIS, {
      connected: true,
    });
    expect(await rowOf(BORIS).findByRole('button', { name: 'В своих' })).toBeOnTheScreen();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('новый ответ списка сбрасывает убранные на экране (вернули из профиля — снова «В своих»)', async () => {
    setConnection.mockResolvedValueOnce(social(false));
    const client = createTestQueryClient();
    await openSocial(client);
    expect(await screen.findByText('Борис Л.')).toBeOnTheScreen();
    await fireEvent.press(rowOf(BORIS).getByRole('button', { name: 'В своих' }));
    expect(await rowOf(BORIS).findByRole('button', { name: 'В свои' })).toBeOnTheScreen();

    // ответ сервера тот же (структурно равен), меняется только dataUpdatedAt
    jest.setSystemTime(new Date('2026-10-31T10:01:00Z'));
    await client.refetchQueries({ queryKey: ['social'] });
    // список перемонтирован — строку ищем заново на каждой попытке
    await waitFor(() =>
      expect(rowOf(BORIS).getByRole('button', { name: 'В своих' })).toBeOnTheScreen(),
    );
  });

  it('429 при возврате — текст у кнопки', async () => {
    setConnection.mockResolvedValueOnce(social(false)).mockRejectedValueOnce(
      new ApiHttpError(429, {
        code: 'RATE_LIMITED',
        message: 'x',
        details: { retryAfterSec: 60 },
      }),
    );
    await openSocial();
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    await fireEvent.press(rowOf(ANNA).getByRole('button', { name: 'В своих' }));
    await fireEvent.press(await rowOf(ANNA).findByRole('button', { name: 'В свои' }));
    expect(
      await rowOf(ANNA).findByText('Слишком много действий, попробуйте позже'),
    ).toBeOnTheScreen();
  });

  it('пусто — пояснение, откуда берутся свои', async () => {
    list.mockResolvedValue({ items: [], count: 0 });
    await openSocial();
    expect(await screen.findByText('Пока никого')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Свои появятся после совместного райда или когда вы добавите кого-то из профиля',
      ),
    ).toBeOnTheScreen();
  });

  it('первая загрузка — скелетон, заголовок сразу', async () => {
    list.mockReturnValue(new Promise(() => undefined));
    await openSocial();
    expect(
      await screen.findByTestId('social-skeleton', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Свои')).toBeOnTheScreen();
  });

  it('ошибка — «Не удалось загрузить» с повтором', async () => {
    list.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openSocial();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
  });

  it('уход с экрана инвалидирует [social] («Свои · N» обновится)', async () => {
    const client = createTestQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const router = await openSocial(client);
    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['social'] });
    await fireEvent.press(screen.getByRole('link', { name: /^Анна К\./ }));
    await waitFor(() => expect(router.getPathname()).toBe(`/riders/${ANNA}`));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['social'] }));
  });
});
