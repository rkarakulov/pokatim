/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { Achievement } from '@pokatim/contracts';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { router as expoRouter, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Animated, Text } from 'react-native';

import { AchievementFlashHost } from '@/features/achievements/achievement-flash-host';
import { resetShown } from '@/features/achievements/flash-session';
import { useSessionStore } from '@/features/auth/session-store';
import { api } from '@/lib/api';

import AchievementRoute from '../app/achievements/[code]';
import AchievementFlashRoute from '../app/achievements/flash';
import { liveSession, signInForTest } from './auth-fixtures';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';
import { create } from 'zustand';

jest.mock('@/lib/api');

const RACE_ID = '0190a6f4-0000-7000-8000-000000000201';
const ROUTE_ID = '0190a6f4-0000-7000-8000-000000000301';

const item = (overrides: Partial<Achievement> = {}): Achievement => ({
  code: 'race_win',
  object: { kind: 'race', id: RACE_ID, title: 'Гонка у озера' },
  factDate: '2026-05-02',
  level: null,
  seen: false,
  ...overrides,
});
const routeItem = item({
  code: 'route_first',
  object: { kind: 'route', id: ROUTE_ID, title: 'Петля' },
  factDate: '2026-04-01',
});

const SEASON_A = '0190a6f4-0000-7000-8000-000000000401';
const SEASON_B = '0190a6f4-0000-7000-8000-000000000402';
const seasonItem = (seasonId: string, overrides: Partial<Achievement> = {}) =>
  item({
    code: 'season_podium',
    object: {
      kind: 'season',
      id: seasonId,
      title: seasonId === SEASON_A ? 'Сезон 2024' : 'Сезон 2025',
    },
    factDate: seasonId === SEASON_A ? '2024-10-31' : '2025-10-31',
    ...overrides,
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
function AchievementStory() {
  return <Text>Карточка достижения</Text>;
}
/** `ready` хоста (вошёл и прошёл онбординг) — переключается тестом: выход и вход другим аккаунтом. */
const readyStore = create<{ ready: boolean }>(() => ({ ready: true }));
function Layout() {
  const ready = readyStore((state) => state.ready);
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <AchievementFlashHost ready={ready} />
    </>
  );
}

const open = (initialUrl = '/', ready = true, client: QueryClient = createTestQueryClient()) => {
  readyStore.setState({ ready });
  return renderRouter(
    {
      _layout: Layout,
      index: Home,
      'achievements/flash': AchievementFlashRoute,
      'races/story/[id]': Story,
      'achievements/story/[code]': AchievementStory,
      'seasons/[id]': () => <Text>Сезон</Text>,
      other: () => <Text>Другой экран</Text>,
    },
    { initialUrl, wrapper: createQueryWrapper(client) },
  );
};

const never = () => new Promise<never>(() => undefined);

beforeEach(() => {
  resetShown();
  signInForTest();
  useSessionStore.setState({ session: liveSession });
  reduceMotion.mockResolvedValue(true);
  markSeen.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

describe('хост вспышки (A5, AC9)', () => {
  it('новое достижение → вспышка; «Закрыть» → seen, повторно не открывается', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
    const router = await open();
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/achievements/flash');
    await waitFor(() =>
      expect(markSeen).toHaveBeenCalledWith(liveSession.accessToken, ['race_win'], []),
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
    listAchievements.mockResolvedValue({ progress: [], items: [item({ seen: true })] });
    const router = await open();
    await waitFor(() => expect(listAchievements).toHaveBeenCalled());
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
    expect(screen.getByText('Главная')).toBeOnTheScreen();
  });

  it('незнакомый код старой сборки (RC-8) — вспышки нет', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [item({ code: 'unknown' })] });
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
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
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
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
    await open('/', false);
    expect(await screen.findByText('Главная')).toBeOnTheScreen();
    expect(listAchievements).not.toHaveBeenCalled();
  });

  it('на экране сторис — не открывается', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
    const router = await open(`/races/story/${RACE_ID}`);
    await waitFor(() => expect(listAchievements).toHaveBeenCalled());
    await act(async () => undefined);
    expect(router.getPathname()).toBe(`/races/story/${RACE_ID}`);
  });
  it('выход и вход другим аккаунтом — показанное прежним снова вспыхивает (`resetShown`)', async () => {
    const client = createTestQueryClient();
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
    const router = await open('/', true, client);
    await fireEvent.press(await screen.findByRole('button', { name: 'Закрыть' }));
    expect(await screen.findByText('Главная')).toBeOnTheScreen();

    // выход: корневой layout чистит кэш, хост без `ready`; вход другим аккаунтом — тот же код не просмотрен
    await act(async () => {
      readyStore.setState({ ready: false });
      client.clear();
    });
    await act(async () => readyStore.setState({ ready: true }));
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/achievements/flash');
  });

  it('возврат на передний план (`focusManager`) после `staleTime` — новое достижение вспыхивает', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [item({ seen: true })] });
    const router = await open();
    await waitFor(() => expect(listAchievements).toHaveBeenCalledTimes(1));
    expect(router.getPathname()).toBe('/');

    listAchievements.mockResolvedValue({ progress: [], items: [routeItem, item({ seen: true })] });
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByRole('header', { name: 'Первый маршрут' })).toBeOnTheScreen();
    expect(listAchievements).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  });

  it('«назад» посреди очереди (1 из 2) — вспышка не открывается сразу; остаток — после нового ответа сервера', async () => {
    const client = createTestQueryClient();
    listAchievements.mockResolvedValue({ progress: [], items: [item(), routeItem] });
    const router = await open('/', true, client);
    expect(await screen.findByText('1 из 2')).toBeOnTheScreen();
    await act(() => expoRouter.back());
    expect(await screen.findByText('Главная')).toBeOnTheScreen();
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');

    await act(async () => client.invalidateQueries());
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/achievements/flash');
    // остаток — одна выдача, без счётчика; показанная раньше не повторяется
    expect(screen.queryByText(/из 2/)).toBeNull();
  });

  it('«Поделиться» посреди очереди (1 из 2) → карточка, выход из карточки — вспышка не открывается сразу', async () => {
    // от новых к старым: гонка старше — показывается первой
    listAchievements.mockResolvedValue({
      progress: [],
      items: [{ ...routeItem, factDate: '2026-06-01' }, item()],
    });
    const router = await open();
    expect(await screen.findByText('1 из 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Поделиться' }));
    expect(await screen.findByText('Карточка достижения')).toBeOnTheScreen();
    await act(() => expoRouter.back());
    expect(await screen.findByText('Главная')).toBeOnTheScreen();
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
  });
});

describe('ответ сервера, пришедший при открытой вспышке (ревью pass 2, LOW-1)', () => {
  it('новый ответ во время показа, затем «назад» на 1 из 2 — вспышка не открывается снова', async () => {
    const client = createTestQueryClient();
    listAchievements.mockResolvedValue({ progress: [], items: [item(), routeItem] });
    const router = await open('/', true, client);
    expect(await screen.findByText('1 из 2')).toBeOnTheScreen();
    // возврат из фона / фокус вкладки: перезапрос при открытой вспышке, на сервере остаток всё ещё не просмотрен
    const before = client.getQueryState(['achievements'])?.dataUpdatedAt ?? 0;
    await act(async () => client.invalidateQueries());
    // ответ пришёл, пока вспышка ещё открыта
    await waitFor(() =>
      expect(client.getQueryState(['achievements'])?.dataUpdatedAt).toBeGreaterThan(before),
    );
    await act(async () => undefined);

    await act(() => expoRouter.back());
    expect(await screen.findByText('Главная')).toBeOnTheScreen();
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/');
    // переход на другой экран (хост пересчитывает очередь) — ответ, пришедший за время показа, остаток не открывает
    await act(() => expoRouter.push('/other'));
    expect(await screen.findByText('Другой экран')).toBeOnTheScreen();
    await act(async () => undefined);
    expect(router.getPathname()).toBe('/other');
  });
});

describe('прямой адрес до восстановления сессии (ревью pass 2, HIGH codex)', () => {
  const realHydrate = useSessionStore.getState().hydrate;
  afterEach(() => useSessionStore.setState({ hydrate: realHydrate }));

  it.each([
    ['/achievements/flash', 'Победа'],
    ['/achievements/race_win', 'Победа'],
  ])(
    '%s: unknown → скелетон без запроса; unavailable → «Нет соединения»; повтор hydrate → signedIn → достижение',
    async (path, title) => {
      const hydrate = jest.fn(async () => {
        useSessionStore.setState({ status: 'signedIn', session: liveSession, restoreError: null });
      });
      useSessionStore.setState({ status: 'unknown', session: null, hydrate });
      listAchievements.mockResolvedValue({ progress: [], items: [item()] });
      await renderRouter(
        {
          index: Home,
          'achievements/flash': AchievementFlashRoute,
          'achievements/[code]': AchievementRoute,
        },
        { initialUrl: path, wrapper: createQueryWrapper() },
      );
      expect(await screen.findByLabelText('Загрузка')).toBeOnTheScreen();
      expect(listAchievements).not.toHaveBeenCalled();

      await act(async () =>
        useSessionStore.setState({
          status: 'unavailable',
          restoreError: new ApiNetworkError(new TypeError('Network request failed')),
        }),
      );
      expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
      expect(listAchievements).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
      expect(hydrate).toHaveBeenCalled();
      expect(await screen.findByRole('header', { name: title })).toBeOnTheScreen();
      expect(listAchievements).toHaveBeenCalledWith(liveSession.accessToken);
    },
  );
});

describe('вспышка открыта по адресу без данных (§4.12)', () => {
  it('первая загрузка — скелетон карточки и «Закрыть»', async () => {
    listAchievements.mockReturnValue(never());
    await open('/achievements/flash');
    expect(await screen.findByLabelText('Загрузка')).toBeOnTheScreen();
    expect(
      screen.getByTestId('achievement-card-skeleton', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeOnTheScreen();
  });

  it('ошибка — «Не удалось загрузить» с повтором; повтор показывает вспышку', async () => {
    listAchievements
      .mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }))
      .mockResolvedValue({ progress: [], items: [item()] });
    await open('/achievements/flash');
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
  });

  it('офлайн — «Нет соединения»; «Закрыть» — на Главную', async () => {
    onlineManager.setOnline(false);
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
    const router = await open('/achievements/flash');
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(router.getPathname()).toBe('/'));
  });
});

describe('экран вспышки (AC10, AC11, AC13)', () => {
  it('несколько новых — от старых к новым, «Дальше» по очереди, затем «Закрыть»', async () => {
    // ответ — от новых к старым
    listAchievements.mockResolvedValue({ progress: [], items: [item(), routeItem] });
    const router = await open();
    expect(await screen.findByRole('header', { name: 'Первый маршрут' })).toBeOnTheScreen();
    expect(screen.getByText('1 из 2')).toBeOnTheScreen();
    expect(screen.getByText('Маршрут «Петля»')).toBeOnTheScreen();
    expect(screen.getByText('1 апреля 2026')).toBeOnTheScreen();
    // маршрутное — «Поделиться» карточкой достижения, не последнее — без «Закрыть»
    expect(screen.getByRole('button', { name: 'Поделиться' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    await waitFor(() =>
      expect(markSeen).toHaveBeenCalledWith(liveSession.accessToken, ['route_first'], []),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Дальше' }));
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(screen.getByText('2 из 2')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Дальше' })).toBeNull();
    await waitFor(() =>
      expect(markSeen).toHaveBeenLastCalledWith(liveSession.accessToken, ['race_win'], []),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(router.getPathname()).toBe('/'));
    expect(markSeen).toHaveBeenCalledTimes(2);
  });

  it('«Поделиться» открывает карточку достижения (вместо вспышки)', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
    const router = await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(router.getPathname()).toBe('/achievements/story/race_win'));
    expect(await screen.findByText('Карточка достижения')).toBeOnTheScreen();
    expect(markSeen).toHaveBeenCalledWith(liveSession.accessToken, ['race_win'], []);
  });

  it('незнакомый вид объекта — «Поделиться» карточкой достижения (код известен)', async () => {
    listAchievements.mockResolvedValue({
      progress: [],
      items: [item({ object: { kind: 'unknown', id: RACE_ID, title: 'Что-то' } })],
    });
    const router = await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Поделиться' }));
    await waitFor(() => expect(router.getPathname()).toBe('/achievements/story/race_win'));
  });

  it('«Уменьшить движение» — значок без анимации', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
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
    listAchievements.mockResolvedValue({ progress: [], items: [item()] });
    await open();
    expect(await screen.findByTestId('achievement-badge-animated')).toBeOnTheScreen();
    expect(timing).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    timing.mockRestore();
  });

  it('повышение уровня — «Новый уровень», метка и условие уровня, число порога; новое на бронзе — «Новое достижение»', async () => {
    listAchievements.mockResolvedValue({
      progress: [],
      items: [
        item({ code: 'races_5', level: 'silver' }),
        item({
          code: 'rides_10',
          level: 'bronze',
          object: { kind: 'ride', id: ROUTE_ID, title: 'Кофе' },
        }),
      ],
    });
    await open();
    expect(await screen.findByRole('header', { name: 'Завсегдатай' })).toBeOnTheScreen();
    expect(screen.getByText('Новое достижение')).toBeOnTheScreen();
    expect(screen.getByText('Бронза')).toBeOnTheScreen();
    expect(screen.getByText('10 прошедших кофе-райдов')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Дальше' }));
    expect(await screen.findByRole('header', { name: 'Гонщик' })).toBeOnTheScreen();
    expect(screen.getByText('Новый уровень')).toBeOnTheScreen();
    expect(screen.getByText('Серебро')).toBeOnTheScreen();
    expect(screen.getByText('Финиш в зачёте 15 разных гонок')).toBeOnTheScreen();
    expect(screen.getByText('15', { includeHiddenElements: true })).toBeOnTheScreen();
    await waitFor(() =>
      expect(markSeen).toHaveBeenLastCalledWith(liveSession.accessToken, ['races_5'], []),
    );
  });

  it('незнакомый уровень — без метки и числа, условие бронзы, «Новое достижение»', async () => {
    listAchievements.mockResolvedValue({
      progress: [],
      items: [item({ code: 'races_5', level: 'unknown' })],
    });
    await open();
    expect(await screen.findByRole('header', { name: 'Гонщик' })).toBeOnTheScreen();
    expect(screen.getByText('Новое достижение')).toBeOnTheScreen();
    expect(screen.getByText('Финиш в зачёте 5 разных гонок')).toBeOnTheScreen();
    for (const label of ['Бронза', 'Серебро', 'Золото'])
      expect(screen.queryByText(label)).toBeNull();
  });

  it('сезонные: два «Призёра» разных сезонов — оба по очереди, seen по (code, seasonId); без «Поделиться»; «К сезону» → сезон', async () => {
    listAchievements.mockResolvedValue({
      progress: [],
      items: [seasonItem(SEASON_B), seasonItem(SEASON_A)],
    });
    const router = await open();
    expect(await screen.findByRole('header', { name: 'Призёр сезона' })).toBeOnTheScreen();
    expect(screen.getByText('1 из 2')).toBeOnTheScreen();
    expect(screen.getByText('Сезон «Сезон 2024»')).toBeOnTheScreen();
    expect(screen.getByText('Место с первого по третье в таблице сезона')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
    await waitFor(() =>
      expect(markSeen).toHaveBeenCalledWith(
        liveSession.accessToken,
        [],
        [{ code: 'season_podium', seasonId: SEASON_A }],
      ),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Дальше' }));
    expect(await screen.findByText('Сезон «Сезон 2025»')).toBeOnTheScreen();
    await waitFor(() =>
      expect(markSeen).toHaveBeenLastCalledWith(
        liveSession.accessToken,
        [],
        [{ code: 'season_podium', seasonId: SEASON_B }],
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'К сезону' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/seasons/${SEASON_B}`));
    expect(await screen.findByText('Сезон')).toBeOnTheScreen();
  });

  it('открыт напрямую без новых — на Главную', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [item({ seen: true })] });
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
        'seasons/[id]': () => <Text>Сезон</Text>,
        profile: () => <Text>Профиль</Text>,
      },
      { initialUrl: `/achievements/${code}`, wrapper: createQueryWrapper() },
    );

  it('гоночное: макет вспышки без «Дальше», «Сторис результата» → сторис; seen не шлёт', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [item({ seen: true })] });
    const router = await openCode('race_win');
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
    expect(screen.getByText('Первое место в своей группе')).toBeOnTheScreen();
    expect(screen.getByText('Гонка «Гонка у озера»')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Дальше' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Сторис результата' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/story/${RACE_ID}`));
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('маршрутное — без «Сторис результата»', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [{ ...routeItem, seen: true }] });
    await openCode('route_first');
    expect(await screen.findByRole('header', { name: 'Первый маршрут' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Сторис результата' })).toBeNull();
  });

  it('сезонное `?season=` — нужный сезон; без «Поделиться»; «К сезону» → сезон', async () => {
    listAchievements.mockResolvedValue({
      progress: [],
      items: [seasonItem(SEASON_B, { seen: true }), seasonItem(SEASON_A, { seen: true })],
    });
    const router = await openCode(`season_podium?season=${SEASON_A}`);
    expect(await screen.findByRole('header', { name: 'Призёр сезона' })).toBeOnTheScreen();
    expect(screen.getByText('Сезон «Сезон 2024»')).toBeOnTheScreen();
    expect(screen.queryByText('Сезон «Сезон 2025»')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сторис результата' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'К сезону' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/seasons/${SEASON_A}`));
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('сезонный код без `?season=` — нет в списке (ключ — код + сезон)', async () => {
    listAchievements.mockResolvedValue({
      progress: [],
      items: [seasonItem(SEASON_A, { seen: true })],
    });
    await openCode('season_podium');
    expect(await screen.findByText('Достижения нет')).toBeOnTheScreen();
  });

  it('старый ответ без сезонных и незнакомый код — экран не ломается', async () => {
    listAchievements.mockResolvedValue({
      progress: [],
      items: [item({ code: 'unknown', seen: true }), item({ seen: true })],
    });
    await openCode('race_win');
    expect(await screen.findByRole('header', { name: 'Победа' })).toBeOnTheScreen();
  });

  it('нет в списке (отозвано, незнакомый адрес) — пустое состояние → профиль', async () => {
    listAchievements.mockResolvedValue({ progress: [], items: [] });
    const router = await openCode('race_podium');
    expect(await screen.findByText('Достижения нет')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К профилю' }));
    await waitFor(() => expect(router.getPathname()).toBe('/profile'));
  });
});
