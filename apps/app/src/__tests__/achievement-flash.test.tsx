/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { Achievement } from '@pokatim/contracts';
import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Animated, Text } from 'react-native';

import { AchievementFlashHost } from '@/features/achievements/achievement-flash-host';
import { resetShown } from '@/features/achievements/flash-session';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import AchievementRoute from '../app/achievements/[code]';
import AchievementFlashRoute from '../app/achievements/flash';
import { liveSession, signInForTest } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const RACE_ID = '0190a6f4-0000-7000-8000-000000000201';
const ROUTE_ID = '0190a6f4-0000-7000-8000-000000000301';

const item = (overrides: Partial<Achievement> = {}): Achievement => ({
  code: 'race_win',
  object: { kind: 'race', id: RACE_ID, title: 'Гонка у озера' },
  factDate: '2026-05-02',
  seen: false,
  ...overrides,
});
const routeItem = item({
  code: 'route_first',
  object: { kind: 'route', id: ROUTE_ID, title: 'Петля' },
  factDate: '2026-04-01',
});

const listAchievements = jest.mocked(api.listAchievements);
const markSeen = jest.mocked(api.markAchievementsSeen);
const reduceMotion = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');

function Home() {
  return <Text>Главная</Text>;
}
function Story() {
  return <Text>Сторис</Text>;
}
function layout(ready: boolean) {
  return function Layout() {
    return (
      <>
        <Stack screenOptions={{ headerShown: false }} />
        <AchievementFlashHost ready={ready} />
      </>
    );
  };
}

const open = (initialUrl = '/', ready = true) =>
  renderRouter(
    {
      _layout: layout(ready),
      index: Home,
      'achievements/flash': AchievementFlashRoute,
      'races/story/[id]': Story,
    },
    { initialUrl, wrapper: createQueryWrapper() },
  );

beforeEach(() => {
  resetShown();
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  reduceMotion.mockResolvedValue(true);
  markSeen.mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

describe('хост вспышки (A5, AC9)', () => {
  it('новое достижение → вспышка; «Закрыть» → seen, повторно не открывается', async () => {
    listAchievements.mockResolvedValue({ items: [item()] });
    const router = await open();
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/achievements/flash');
    await waitFor(() =>
      expect(markSeen).toHaveBeenCalledWith(liveSession.accessToken, ['race_win']),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    expect(await screen.findByText('Главная')).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
    // кэш помечен оптимистично: вспышка не открывается снова
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it('всё просмотрено — вспышки нет', async () => {
    listAchievements.mockResolvedValue({ items: [item({ seen: true })] });
    const router = await open();
    await waitFor(() => expect(listAchievements).toHaveBeenCalled());
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
    expect(screen.getByText('Главная')).toBeOnTheScreen();
  });

  it('незнакомый код старой сборки (RC-8) — вспышки нет', async () => {
    listAchievements.mockResolvedValue({ items: [item({ code: 'unknown' })] });
    const router = await open();
    await waitFor(() => expect(listAchievements).toHaveBeenCalled());
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
  });

  it('ошибка запроса — тишина: ни вспышки, ни баннера', async () => {
    listAchievements.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    const router = await open();
    await waitFor(() => expect(listAchievements).toHaveBeenCalled());
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });

  it('сбой `seen` — кэш откатывается, но в этом запуске вспышка не повторяется', async () => {
    listAchievements.mockResolvedValue({ items: [item()] });
    markSeen.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    const router = await open();
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    await waitFor(() => expect(markSeen).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    expect(await screen.findByText('Главная')).toBeOnTheScreen();
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
  });

  it('не вошёл / онбординг не пройден (`ready: false`) — без запроса', async () => {
    listAchievements.mockResolvedValue({ items: [item()] });
    await open('/', false);
    expect(await screen.findByText('Главная')).toBeOnTheScreen();
    expect(listAchievements).not.toHaveBeenCalled();
  });

  it('на экране сторис — не открывается', async () => {
    listAchievements.mockResolvedValue({ items: [item()] });
    const router = await open(`/races/story/${RACE_ID}`);
    await waitFor(() => expect(listAchievements).toHaveBeenCalled());
    await act(async () => undefined);
    expect(router.getPathname()).toBe(`/races/story/${RACE_ID}`);
  });
});

describe('экран вспышки (AC10, AC11, AC13)', () => {
  it('несколько новых — от старых к новым, «Дальше» по очереди, затем «Закрыть»', async () => {
    // ответ — от новых к старым
    listAchievements.mockResolvedValue({ items: [item(), routeItem] });
    const router = await open();
    expect(await screen.findByRole('header', { name: 'Первый маршрут' })).toBeOnTheScreen();
    expect(screen.getByText('1 из 2')).toBeOnTheScreen();
    expect(screen.getByText('Маршрут «Петля»')).toBeOnTheScreen();
    expect(screen.getByText('1 апреля 2026')).toBeOnTheScreen();
    // маршрутное — без «Поделиться», не последнее — без «Закрыть»
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    await waitFor(() =>
      expect(markSeen).toHaveBeenCalledWith(liveSession.accessToken, ['route_first']),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Дальше' }));
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(screen.getByText('2 из 2')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Дальше' })).toBeNull();
    await waitFor(() =>
      expect(markSeen).toHaveBeenLastCalledWith(liveSession.accessToken, ['race_win']),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(router.getPathname()).toBe('/'));
    expect(markSeen).toHaveBeenCalledTimes(2);
  });

  it('гоночное — «Поделиться» открывает сторис результата гонки', async () => {
    listAchievements.mockResolvedValue({ items: [item()] });
    const router = await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/story/${RACE_ID}`));
    expect(await screen.findByText('Сторис')).toBeOnTheScreen();
    expect(markSeen).toHaveBeenCalledWith(liveSession.accessToken, ['race_win']);
  });

  it('незнакомый вид объекта — без «Поделиться»', async () => {
    listAchievements.mockResolvedValue({
      items: [item({ object: { kind: 'unknown', id: RACE_ID, title: 'Что-то' } })],
    });
    await open();
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
  });

  it('«Уменьшить движение» — значок без анимации', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    listAchievements.mockResolvedValue({ items: [item()] });
    await open();
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    await act(async () => undefined);
    expect(screen.getByTestId('achievement-badge-static')).toBeOnTheScreen();
    expect(screen.queryByTestId('achievement-badge-animated')).toBeNull();
    expect(timing).not.toHaveBeenCalled();
    timing.mockRestore();
  });

  it('движение разрешено — одно появление значка', async () => {
    reduceMotion.mockResolvedValue(false);
    const start = jest.fn();
    const timing = jest
      .spyOn(Animated, 'timing')
      .mockReturnValue({ start, stop: jest.fn(), reset: jest.fn() });
    listAchievements.mockResolvedValue({ items: [item()] });
    await open();
    expect(await screen.findByTestId('achievement-badge-animated')).toBeOnTheScreen();
    expect(timing).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    timing.mockRestore();
  });

  it('открыт напрямую без новых — на Главную', async () => {
    listAchievements.mockResolvedValue({ items: [item({ seen: true })] });
    const router = await open('/achievements/flash');
    await waitFor(() => expect(router.getPathname()).toBe('/'));
    expect(markSeen).not.toHaveBeenCalled();
  });
});

describe('экран своего достижения /achievements/[code] (A6)', () => {
  const openCode = (code: string) =>
    renderRouter(
      {
        'achievements/[code]': AchievementRoute,
        'races/story/[id]': Story,
        profile: () => <Text>Профиль</Text>,
      },
      { initialUrl: `/achievements/${code}`, wrapper: createQueryWrapper() },
    );

  it('гоночное: макет вспышки без «Дальше», «Поделиться» → сторис; seen не шлёт', async () => {
    listAchievements.mockResolvedValue({ items: [item({ seen: true })] });
    const router = await openCode('race_win');
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(screen.getByText('Первое место в своей группе')).toBeOnTheScreen();
    expect(screen.getByText('Гонка «Гонка у озера»')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Дальше' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/story/${RACE_ID}`));
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('маршрутное — без «Поделиться»', async () => {
    listAchievements.mockResolvedValue({ items: [{ ...routeItem, seen: true }] });
    await openCode('route_first');
    expect(await screen.findByRole('header', { name: 'Первый маршрут' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
  });

  it('нет в списке (отозвано, незнакомый адрес) — пустое состояние → профиль', async () => {
    listAchievements.mockResolvedValue({ items: [] });
    const router = await openCode('race_podium');
    expect(await screen.findByText('Достижения нет')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К профилю' }));
    await waitFor(() => expect(router.getPathname()).toBe('/profile'));
  });
});
