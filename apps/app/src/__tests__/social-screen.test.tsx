/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RiderSocial, SocialConnectionRow } from '@pokatim/contracts';
import { layout, themes } from '@pokatim/design-tokens';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Text, useColorScheme } from 'react-native';

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

// jest-пресет React Native подменяет useColorScheme на jest.fn(() => 'light')
const colorScheme = jest.mocked(useColorScheme);
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
  colorScheme.mockReturnValue('light');
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

  it('«Убрать» → PUT false, строка остаётся приглушённой с «Вернуть»; «Вернуть» → PUT true; список не перезапрашивается', async () => {
    setConnection.mockResolvedValueOnce(social(false));
    await openSocial();
    expect(await screen.findByText('Борис Л.')).toBeOnTheScreen();
    // обычная строка: имя основным цветом, аватар без приглушения
    expect(rowOf(BORIS).getByText('Борис Л.')).toHaveStyle({ color: themes.light.text.primary });
    expect(
      rowOf(BORIS).getByTestId('social-row-avatar', { includeHiddenElements: true }),
    ).not.toHaveStyle({
      opacity: layout.mutedOpacity,
    });
    const remove = rowOf(BORIS).getByRole('button', { name: 'Убрать из своих: Борис Л.' });
    expect(within(remove).getByText('Убрать')).toBeOnTheScreen();
    await fireEvent.press(remove);
    expect(setConnection).toHaveBeenCalledWith(liveSession.accessToken, BORIS, {
      connected: false,
    });

    const restore = await rowOf(BORIS).findByRole('button', { name: 'Вернуть в свои: Борис Л.' });
    expect(within(restore).getByText('Вернуть')).toBeOnTheScreen();
    // убранная строка: серое имя, аватар приглушён, подпись та же (высота строки не меняется)
    expect(rowOf(BORIS).getByText('Борис Л.')).toHaveStyle({ color: themes.light.text.secondary });
    expect(rowOf(BORIS).getByText('Добавлены вами')).toBeOnTheScreen();
    expect(
      rowOf(BORIS).getByTestId('social-row-avatar', { includeHiddenElements: true }),
    ).toHaveStyle({
      opacity: layout.mutedOpacity,
    });
    expect(
      rowOf(BORIS).getByRole('link', { name: 'Борис Л.. Добавлены вами. Убраны из своих' }),
    ).toBeOnTheScreen();

    setConnection.mockResolvedValueOnce(social(true));
    await fireEvent.press(restore);
    expect(setConnection).toHaveBeenLastCalledWith(liveSession.accessToken, BORIS, {
      connected: true,
    });
    expect(
      await rowOf(BORIS).findByRole('button', { name: 'Убрать из своих: Борис Л.' }),
    ).toBeOnTheScreen();
    expect(rowOf(BORIS).getByRole('link', { name: 'Борис Л.. Добавлены вами' })).toBeOnTheScreen();
    expect(rowOf(BORIS).getByText('Борис Л.')).toHaveStyle({ color: themes.light.text.primary });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('тёмная тема: убранная строка — серое имя тёмной темы', async () => {
    colorScheme.mockReturnValue('dark');
    setConnection.mockResolvedValueOnce(social(false));
    await openSocial();
    expect(await screen.findByText('Борис Л.')).toHaveStyle({ color: themes.dark.text.primary });
    await fireEvent.press(rowOf(BORIS).getByRole('button', { name: 'Убрать из своих: Борис Л.' }));
    expect(
      await rowOf(BORIS).findByRole('button', { name: 'Вернуть в свои: Борис Л.' }),
    ).toBeOnTheScreen();
    expect(rowOf(BORIS).getByText('Борис Л.')).toHaveStyle({ color: themes.dark.text.secondary });
  });

  it('новый ответ списка сбрасывает убранные на экране (вернули из профиля — снова «Убрать»)', async () => {
    setConnection.mockResolvedValueOnce(social(false));
    const client = createTestQueryClient();
    await openSocial(client);
    expect(await screen.findByText('Борис Л.')).toBeOnTheScreen();
    await fireEvent.press(rowOf(BORIS).getByRole('button', { name: 'Убрать из своих: Борис Л.' }));
    expect(
      await rowOf(BORIS).findByRole('button', { name: 'Вернуть в свои: Борис Л.' }),
    ).toBeOnTheScreen();

    // ответ сервера тот же (структурно равен), меняется только dataUpdatedAt
    jest.setSystemTime(new Date('2026-10-31T10:01:00Z'));
    await client.refetchQueries({ queryKey: ['social'] });
    // список перемонтирован — строку ищем заново на каждой попытке
    await waitFor(() =>
      expect(
        rowOf(BORIS).getByRole('button', { name: 'Убрать из своих: Борис Л.' }),
      ).toBeOnTheScreen(),
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
    await fireEvent.press(rowOf(ANNA).getByRole('button', { name: 'Убрать из своих: Анна К.' }));
    await fireEvent.press(
      await rowOf(ANNA).findByRole('button', { name: 'Вернуть в свои: Анна К.' }),
    );
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
