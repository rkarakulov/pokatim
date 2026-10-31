/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RideCard, RideMap, RidePage } from '@pokatim/contracts';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { Linking, Text, type FlatList } from 'react-native';

import type * as Position from '@/features/location/current-position';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper, createTestQueryClient } from './query-wrapper';

jest.mock('@/lib/api');
// 05c «Рядом»: одно чтение позиции — мок модуля (Geolocation и expo-location — тесты current-position)
jest.mock('@/features/location/current-position', () => ({ readCurrentPosition: jest.fn() }));
const readPosition = jest.mocked(
  jest.requireMock<typeof Position>('@/features/location/current-position').readCurrentPosition,
);
const listRideMap = jest.mocked(api.listRideMap);

const listRides = jest.mocked(api.listRides);
const listRideCities = jest.mocked(api.listRideCities);
const joinRide = jest.mocked(api.joinRide);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');

const none = {
  role: 'none',
  canJoin: true,
  canLeave: false,
  canManage: false,
  reported: false,
  canReport: false,
} as const;
let seq = 0;
const ride = (overrides: Partial<RideCard> = {}): RideCard => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`,
  title: `Райд ${seq}`,
  organizerName: null,
  startsAt: '2026-10-04T07:00:00Z',
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
  viewer: none,
  ...overrides,
});
const page = (items: RideCard[], nextCursor: string | null = null): RidePage => ({
  items,
  nextCursor,
});
const never = () => new Promise<never>(() => undefined);

// суббота 3 октября 9:00 — герой; воскресенье 4 октября — строки
const hero = ride({
  title: 'Минское море',
  startsAt: '2026-10-03T06:00:00Z',
  distanceKm: 104,
  paceMinKmh: 25,
  paceMaxKmh: 27,
});
const going = ride({
  title: 'Участник',
  viewer: {
    role: 'participant',
    canJoin: false,
    canLeave: true,
    canManage: false,
    reported: false,
    canReport: false,
  },
});
const own = ride({
  title: 'Свой',
  goingCount: 1,
  viewer: {
    role: 'organizer',
    canJoin: false,
    canLeave: false,
    canManage: true,
    reported: false,
    canReport: false,
  },
});
const full = ride({
  title: 'Полный',
  goingCount: 12,
  full: true,
  viewer: {
    role: 'none',
    canJoin: false,
    canLeave: false,
    canManage: false,
    reported: false,
    canReport: false,
  },
});
const cancelled = ride({
  title: 'Отменённый',
  phase: 'cancelled',
  cancelReason: 'weather',
  startsAt: '2026-10-05T07:00:00Z',
  viewer: {
    role: 'participant',
    canJoin: false,
    canLeave: false,
    canManage: false,
    reported: false,
    canReport: false,
  },
});
const open = ride({
  title: 'Свободный',
  limit: null,
  goingCount: 7,
  startsAt: '2026-10-05T08:00:00Z',
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  listRides.mockResolvedValue(page([hero, going, own, full, cancelled, open]));
  listRideCities.mockResolvedValue({ cities: ['minsk', 'brest'] });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const routes = {
  ...tabRoutes,
  'rides/[id]': () => <Text>Карточка райда</Text>,
  'rides/new': () => <Text>Новый райд</Text>,
};
const openRides = () =>
  renderRouter(routes, { initialUrl: '/rides', wrapper: createQueryWrapper() });
const feed = () => screen.getByTestId('rides-feed');
const heroLabel = 'Ближайший райд. Минское море. Сб 3 октября, 9:00';
const SOFT_PROMPT = 'Узнайте о переносе или отмене райда';
const rowOf = (title: string) =>
  screen.getByRole('link', { name: new RegExp(`^${title}\\. `) }).parent as never;

describe('вкладка «Райды» (S3)', () => {
  it('шапка, «Создать райд» и подпись «Город» сразу; скелетон ряда и данных', async () => {
    listRides.mockReturnValue(never());
    listRideCities.mockReturnValue(never());
    await openRides();

    expect(screen.getByRole('header', { name: 'Ближайшие кофе-райды' })).toBeOnTheScreen();
    expect(screen.getByText('Кофе-райды')).toBeOnTheScreen();
    expect(screen.queryByText(/рядом с вами/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Создать райд' })).toBeOnTheScreen();
    expect(screen.getByText('Город')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка').length).toBeGreaterThanOrEqual(2);
  });

  it('герой — первый райд (дата, мета, стопка, «Я иду»); строки по дням с подписью дня; запрос с Bearer', async () => {
    await openRides();

    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.getByText('104 км · темп 25–27 км/ч · Минск, Парк Победы')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Все райды' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Воскресенье, 4 октября' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Понедельник, 5 октября' })).toBeOnTheScreen();
    expect(screen.getAllByText('10:00 · Минск').length).toBeGreaterThanOrEqual(3);
    expect(
      screen.getAllByText('42 км · темп 22–24 км/ч · старт: Парк Победы').length,
    ).toBeGreaterThan(0);
    expect(listRides).toHaveBeenCalledWith(liveSession.accessToken, { city: [], limit: 20 });
  });

  it('действия строк по viewer сервера: «Вы идёте», «Вы организатор», «Мест нет», «Райд отменён», «Я иду»', async () => {
    await openRides();
    await screen.findByRole('link', { name: heroLabel });

    expect(within(rowOf('Участник')).getByText('Вы идёте')).toBeOnTheScreen();
    expect(within(rowOf('Участник')).getByText('идут 5 из 12 · вы в списке')).toBeOnTheScreen();
    expect(within(rowOf('Свой')).getByText('Вы организатор')).toBeOnTheScreen();
    expect(within(rowOf('Свой')).getByText('идёт 1 из 12 · вы')).toBeOnTheScreen();
    expect(within(rowOf('Полный')).getByText('Мест нет')).toBeOnTheScreen();
    expect(within(rowOf('Полный')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Отменённый')).getByText('Райд отменён')).toBeOnTheScreen();
    expect(within(rowOf('Свободный')).getByText('идут 7')).toBeOnTheScreen();
    expect(within(rowOf('Свободный')).getByRole('button', { name: 'Я иду' })).toBeOnTheScreen();
  });

  it('«Я иду» в строке — мутация с Bearer, затем лента перезапрошена; отказ «Мест нет» — текст у действия', async () => {
    joinRide.mockRejectedValueOnce(new ApiHttpError(409, { code: 'RIDE_FULL', message: 'x' }));
    await openRides();
    await screen.findByRole('link', { name: heroLabel });

    await fireEvent.press(within(rowOf('Свободный')).getByRole('button', { name: 'Я иду' }));
    expect(joinRide).toHaveBeenCalledWith(liveSession.accessToken, open.id);
    expect(await screen.findByText('Мест нет.')).toBeOnTheScreen();
    // отказ мутации — подсказки push нет (N5)
    expect(screen.queryByText(SOFT_PROMPT)).toBeNull();

    joinRide.mockResolvedValueOnce({
      ride: { ...open, goingCount: 8, description: null },
      viewer: {
        role: 'participant',
        canJoin: false,
        canLeave: true,
        canManage: false,
        reported: false,
        canReport: false,
      },
    });
    await fireEvent.press(within(rowOf('Свободный')).getByRole('button', { name: 'Я иду' }));
    await waitFor(() => expect(listRides).toHaveBeenCalledTimes(2));
    // успех в строке — подсказка push под строкой на всю ширину, не в узком слоте действия
    expect(await within(feed()).findByText(SOFT_PROMPT)).toBeOnTheScreen();
    expect(within(rowOf('Свободный')).queryByText(SOFT_PROMPT)).toBeNull();
    expect(screen.getAllByText(SOFT_PROMPT)).toHaveLength(1);
  });

  it('строка и герой ведут в карточку; «Создать райд» — в форму', async () => {
    const router = await openRides();
    await fireEvent.press(await screen.findByRole('link', { name: heroLabel }));
    expect(router.getPathname()).toBe(`/rides/${hero.id}`);

    const again = await openRides();
    await fireEvent.press(await screen.findByRole('button', { name: 'Создать райд' }));
    expect(again.getPathname()).toBe('/rides/new');
  });

  it('фильтр «Город»: чипы из ответа; выбор — запрос с city; «Сбросить фильтры»', async () => {
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    expect(screen.getByRole('button', { name: 'Минск' })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Брест' }));
    await waitFor(() =>
      expect(listRides).toHaveBeenLastCalledWith(liveSession.accessToken, {
        city: ['brest'],
        limit: 20,
      }),
    );
    expect(await screen.findByText('Сбросить фильтры')).toBeOnTheScreen();
    expect(await screen.findByText('Ближайший по фильтрам')).toBeOnTheScreen();
  });

  it('исчезнувший город снимается с фильтра', async () => {
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('button', { name: 'Брест' }));
    await waitFor(() =>
      expect(listRides).toHaveBeenLastCalledWith(liveSession.accessToken, {
        city: ['brest'],
        limit: 20,
      }),
    );

    listRideCities.mockResolvedValue({ cities: ['minsk'] });
    const control = feed().props.refreshControl as ReactElement<{ onRefresh: () => void }>;
    await act(async () => {
      control.props.onRefresh();
    });
    // запрос без фильтра — из кеша первой выдачи (свежий), фильтр снят
    await waitFor(() => expect(screen.queryByText('Сбросить фильтры')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Брест' })).toBeNull();
    expect(screen.getByText('Ближайший райд')).toBeOnTheScreen();
  });

  it('ошибка загрузки городов — подпись «Город», ошибка и «Повторить» в группе; лента работает', async () => {
    listRideCities.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    expect(await screen.findByText('Не удалось загрузить города.')).toBeOnTheScreen();
    expect(screen.getByText('Город')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Брест' })).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить города.')).toBeNull();
  });

  it('ошибка обновления городов при чипах — чипы остаются, рядом ошибка с повтором', async () => {
    await openRides();
    await screen.findByRole('button', { name: 'Брест' });
    listRideCities.mockRejectedValue(new ApiNetworkError(new Error('offline')));
    const control = feed().props.refreshControl as ReactElement<{ onRefresh: () => void }>;
    await act(async () => {
      control.props.onRefresh();
    });
    expect(await screen.findByText('Не удалось обновить города.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Брест' })).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Повторить' }).length).toBeGreaterThan(0);
  });

  it('пусто без фильтров — приглашение и primary «Создать райд» (кнопка шапки скрыта)', async () => {
    listRides.mockResolvedValue(page([]));
    listRideCities.mockResolvedValue({ cities: [] });
    await openRides();

    expect(await screen.findByText('Пока нет кофе-райдов — создайте первый')).toBeOnTheScreen();
    expect(
      screen.getByText('Выберите время старта, место и темп. Райд увидят велосипедисты Беларуси.'),
    ).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Создать райд' })).toHaveLength(1);
    expect(screen.queryByText('Город')).toBeNull();
  });

  it('пусто с фильтром — «Ничего не найдено» + «Сбросить фильтры»', async () => {
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    listRides.mockResolvedValue(page([]));
    await fireEvent.press(screen.getByRole('button', { name: 'Брест' }));

    expect(await screen.findByText('Ничего не найдено')).toBeOnTheScreen();
    expect(screen.getAllByText('Сбросить фильтры').length).toBeGreaterThanOrEqual(1);
  });

  it('ошибка сервера — «Не удалось загрузить» + «Повторить»; офлайн-старт — «Нет соединения»', async () => {
    listRides.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openRides();
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    listRides.mockResolvedValue(page([hero]));
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('офлайн-старт — «Нет соединения» на месте данных', async () => {
    onlineManager.setOnline(false);
    await openRides();
    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    expect(listRides).not.toHaveBeenCalled();
  });

  it('догрузка у конца: курсор, подписи дней поперёк страниц; ошибка догрузки — баннер в подвале', async () => {
    listRides
      .mockResolvedValueOnce(page([hero, going], 'c1'))
      .mockRejectedValueOnce(new ApiNetworkError(new Error('offline')))
      .mockResolvedValueOnce(page([open]));
    await openRides();
    await screen.findByRole('link', { name: heroLabel });

    const list = feed().props as ReactElement<typeof FlatList>['props'] & {
      onEndReached: () => void;
    };
    await act(async () => {
      list.onEndReached();
    });
    expect(await screen.findByText('Повторить')).toBeOnTheScreen();
    expect(listRides).toHaveBeenLastCalledWith(liveSession.accessToken, {
      city: [],
      limit: 20,
      cursor: 'c1',
    });
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('header', { name: 'Понедельник, 5 октября' })).toBeOnTheScreen();
    expect(screen.getAllByRole('header', { name: 'Воскресенье, 4 октября' })).toHaveLength(1);
  });

  it("'unknown' в фазе, городе и роли — без действия и подписи города, экран не падает (AC-T7)", async () => {
    listRides.mockResolvedValue(
      page([
        hero,
        ride({
          title: 'Новое',
          phase: 'unknown',
          city: 'unknown',
          viewer: {
            role: 'unknown',
            canJoin: false,
            canLeave: false,
            canManage: false,
            reported: false,
            canReport: false,
          },
        }),
      ]),
    );
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    expect(within(rowOf('Новое')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Новое')).getByText('10:00')).toBeOnTheScreen();
  });
});

// позиция до округления: в запрос и память уходит только 53.90,27.56
const HERE = [27.56123, 53.90491] as const;
const LIGHT = 'https://tiles.example/styles/positron';

describe('«Рядом», «Список / Карта» (05c)', () => {
  const near = ride({ title: 'Близкий', start: [27.56, 54.008] });
  let client: QueryClient;
  const openWithClient = () => {
    client = createTestQueryClient();
    return renderRouter(routes, { initialUrl: '/rides', wrapper: createQueryWrapper(client) });
  };
  const nearChip = () => screen.getByRole('button', { name: 'Рядом' });

  beforeEach(() => {
    readPosition.mockReset();
    process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
    process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  });

  it('«Рядом» — одно чтение, запрос с округлённым near и радиусом 25; «в N км» у строки; координат нет в ключах и console (AC9)', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn');
    const error = jest.spyOn(console, 'error');
    readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
    await openWithClient();
    await screen.findByRole('link', { name: heroLabel });
    listRides.mockResolvedValue(page([hero, near]));

    await fireEvent.press(nearChip());
    expect(readPosition).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(listRides).toHaveBeenLastCalledWith(liveSession.accessToken, {
        city: [],
        limit: 20,
        near: '53.90,27.56',
        radiusKm: 25,
      }),
    );
    expect(nearChip()).toBeSelected();
    expect(await screen.findByText('в 12 км от вас')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: /^Близкий\. .*в 12 км от вас/ })).toBeOnTheScreen();

    const keys = JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    );
    expect(keys).not.toMatch(/27\.56|53\.9/);
    for (const spy of [log, warn, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/27\.56|53\.9/);
    }
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('повторное нажатие выключает «Рядом»: выдача без near (из кеша), позиция стёрта', async () => {
    readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    listRides.mockResolvedValue(page([near]));
    await fireEvent.press(nearChip());
    expect(await screen.findByText('в 12 км от вас')).toBeOnTheScreen();
    await waitFor(() =>
      expect(listRides).toHaveBeenLastCalledWith(
        liveSession.accessToken,
        expect.objectContaining({ near: '53.90,27.56' }),
      ),
    );
    await fireEvent.press(nearChip());
    expect(nearChip()).not.toBeSelected();
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.queryByText(/км от вас/)).toBeNull();
  });

  it('отказ навсегда (native) — пустое состояние с «Открыть настройки» и «Выбрать город»', async () => {
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    readPosition.mockResolvedValue({ status: 'denied', canOpenSettings: true });
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(nearChip());

    expect(
      await screen.findByText('Включите геопозицию, чтобы видеть райды рядом'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: heroLabel })).toBeNull();
    expect(screen.getByText('Город')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Открыть настройки' }));
    expect(settings).toHaveBeenCalled();
    expect(screen.getByText('Выбрать город')).toBeOnTheScreen();
    settings.mockRestore();
  });

  it('ошибка чтения / web без геолокации — «Разрешить» (повтор) и «Выбрать город» (выключить «Рядом»)', async () => {
    readPosition.mockResolvedValue({ status: 'unavailable' });
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(nearChip());

    await fireEvent.press(await screen.findByRole('button', { name: 'Разрешить' }));
    expect(readPosition).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Открыть настройки' })).toBeNull();

    await fireEvent.press(await screen.findByText('Выбрать город'));
    expect(nearChip()).not.toBeSelected();
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.queryByText('Включите геопозицию, чтобы видеть райды рядом')).toBeNull();
  });

  it('«Карта»: точки старта, «Ещё N райдов без точки», нажатие на точку — карточка → райд; «Список» — обратно', async () => {
    const first = '0190a6f4-0000-7000-8000-00000000a001';
    const second = '0190a6f4-0000-7000-8000-00000000a002';
    const data: RideMap = {
      items: [
        {
          id: first,
          title: 'Море',
          startsAt: '2026-10-03T06:00:00Z',
          start: [27.5615, 53.9023],
          goingCount: 3,
          limit: 10,
          full: false,
        },
        {
          id: second,
          title: 'Море-2',
          startsAt: '2026-10-04T06:00:00Z',
          start: [27.5615, 53.9023],
          goingCount: 1,
          limit: null,
          full: false,
        },
      ],
      withoutStart: 3,
    };
    listRideMap.mockResolvedValue(data);
    const router = await openRides();
    await screen.findByRole('link', { name: heroLabel });
    expect(listRideMap).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('tab', { name: 'Карта' }));
    expect(listRideMap).toHaveBeenCalledWith(liveSession.accessToken, { city: [] });
    expect(await screen.findByText('Ещё 3 райда без точки старта — в списке')).toBeOnTheScreen();
    expect(screen.getByLabelText('Карта точек старта: на карте 2 райда')).toBeOnTheScreen();
    const area = await screen.findByTestId('map-area');
    await fireEvent(area, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 500 } },
    });
    const source = await screen.findByTestId('maplibre-GeoJSONSource');
    expect(source.props.data.features).toHaveLength(1);
    expect(source.props.data.features[0].properties.count).toBe(2);
    await act(async () => {
      source.props.onPress({ nativeEvent: { features: [source.props.data.features[0]] } });
    });
    expect(screen.getByText('В этой точке 2 райда')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: /^Море-2 · / }));
    expect(router.getPathname()).toBe(`/rides/${second}`);
  });

  it('«Карта» без точек — пусто и путь в «Список»', async () => {
    listRideMap.mockResolvedValue({ items: [], withoutStart: 0 });
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('tab', { name: 'Карта' }));
    expect(await screen.findByText('Нет райдов с точкой старта')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Список' }));
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });
});

describe('ревью pass 1: пустые и короткие страницы, «Рядом» в ожидании, карта (05c)', () => {
  const never = () => new Promise<never>(() => undefined);
  beforeEach(() => {
    readPosition.mockReset();
    process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
    process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  });

  it('пустая первая страница с курсором — дочитывание: герой и все строки, без «Ничего не найдено»', async () => {
    listRides
      .mockResolvedValueOnce(page([], 'c1'))
      .mockResolvedValueOnce(page([hero, going, open]));
    await openRides();
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(rowOf('Участник')).toBeTruthy();
    expect(rowOf('Свободный')).toBeTruthy();
    expect(listRides).toHaveBeenLastCalledWith(liveSession.accessToken, {
      city: [],
      limit: 20,
      cursor: 'c1',
    });
    expect(screen.queryByText('Ничего не найдено')).toBeNull();
    expect(screen.queryByText('Пока нет кофе-райдов — создайте первый')).toBeNull();
  });

  it('короткая первая страница — герой из первой страницы, строки — со следующих', async () => {
    listRides.mockResolvedValueOnce(page([hero], 'c1')).mockResolvedValueOnce(page([going]));
    await openRides();
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    const list = feed().props as { onEndReached: () => void };
    await act(async () => list.onEndReached());
    expect(await screen.findByRole('link', { name: /^Участник\. / })).toBeOnTheScreen();
  });

  it('пустая страница в середине — дочитывание следующей сразу', async () => {
    listRides
      .mockResolvedValueOnce(page([hero, going], 'c1'))
      .mockResolvedValueOnce(page([], 'c2'))
      .mockResolvedValueOnce(page([open]));
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    const list = feed().props as { onEndReached: () => void };
    await act(async () => list.onEndReached());
    expect(await screen.findByRole('link', { name: /^Свободный\. / })).toBeOnTheScreen();
    expect(listRides).toHaveBeenLastCalledWith(liveSession.accessToken, {
      city: [],
      limit: 20,
      cursor: 'c2',
    });
  });

  it('много пустых страниц подряд — дочитывание останавливается, «Показать ещё» продолжает', async () => {
    listRides.mockImplementation(async (_token, params) =>
      page([], `c${Number(String(params?.cursor ?? 'c0').slice(1)) + 1}`),
    );
    await openRides();
    const more = await screen.findByRole('button', { name: 'Показать ещё' });
    const calls = listRides.mock.calls.length;
    expect(calls).toBe(5);
    await act(() => jest.advanceTimersByTimeAsync(100));
    expect(listRides).toHaveBeenCalledTimes(calls);
    listRides.mockResolvedValueOnce(page([hero]));
    await fireEvent.press(more);
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('«Рядом»: пока позиция читается — скелетон, а не выдача без near', async () => {
    readPosition.mockReturnValue(never());
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('button', { name: 'Рядом' }));
    expect(screen.queryByRole('link', { name: heroLabel })).toBeNull();
    expect(screen.getAllByLabelText('Загрузка').length).toBeGreaterThan(0);
  });

  it('«Карта» + «Рядом» — near уходит только в запрос карты, не в ленту', async () => {
    readPosition.mockResolvedValue({ status: 'ok', lngLat: HERE });
    listRideMap.mockResolvedValue({ items: [], withoutStart: 0 });
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('tab', { name: 'Карта' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Рядом' }));
    await waitFor(() =>
      expect(listRideMap).toHaveBeenLastCalledWith(liveSession.accessToken, {
        city: [],
        near: '53.90,27.56',
        radiusKm: 25,
      }),
    );
    expect(listRides.mock.calls.some(([, params]) => params?.near !== undefined)).toBe(false);
  });

  it('карточка точки большой группы — прокручиваемый список и «Закрыть» вне него', async () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      id: `0190a6f4-0000-7000-8000-00000000b${String(index).padStart(3, '0')}`,
      title: `Группа ${index}`,
      startsAt: '2026-10-03T06:00:00Z',
      start: [27.5615, 53.9023] as [number, number],
      goingCount: 1,
      limit: null,
      full: false,
    }));
    listRideMap.mockResolvedValue({ items, withoutStart: 0 });
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('tab', { name: 'Карта' }));
    const area = await screen.findByTestId('map-area');
    await fireEvent(area, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 500 } },
    });
    const source = await screen.findByTestId('maplibre-GeoJSONSource');
    await act(async () => {
      source.props.onPress({ nativeEvent: { features: [source.props.data.features[0]] } });
    });
    const list = screen.getByTestId('ride-point-card-list');
    expect(within(list).getAllByRole('link')).toHaveLength(30);
    expect(within(list).queryByRole('button', { name: 'Закрыть' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeOnTheScreen();
    expect(screen.getByTestId('ride-point-card')).toHaveStyle({ maxHeight: '70%' });
  });
});

describe('ревью pass 2: раскладка режима «Карта» (05c)', () => {
  const point = {
    id: '0190a6f4-0000-7000-8000-00000000c001',
    title: 'Море',
    startsAt: '2026-10-03T06:00:00Z',
    start: [27.5615, 53.9023] as [number, number],
    goingCount: 3,
    limit: 10,
    full: false,
  };
  beforeEach(() => {
    process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT = LIGHT;
    process.env.EXPO_PUBLIC_MAP_STYLE_DARK = LIGHT;
  });
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT;
    delete process.env.EXPO_PUBLIC_MAP_STYLE_DARK;
  });

  it('загрузка карты — место на всю область (flex: 1), без SkeletonGroup', async () => {
    listRideMap.mockReturnValue(new Promise<never>(() => undefined));
    await openRides();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('tab', { name: 'Карта' }));
    const place = screen.getByTestId('ride-map-skeleton', { includeHiddenElements: true });
    expect(place).toHaveStyle({ flex: 1 });
    // не внутри SkeletonGroup (его обёртка не растягивается): место само несёт «Загрузка»
    let node = place.parent;
    while (node) {
      expect(node.props.testID).not.toBe('skeleton-group');
      node = node.parent;
    }
    expect(place).toHaveAccessibleName('Загрузка');
  });

  it('ошибка обновления карты — карта остаётся в контейнере flex: 1, рядом баннер с повтором', async () => {
    const client = createTestQueryClient();
    listRideMap.mockResolvedValue({ items: [point], withoutStart: 0 });
    await renderRouter(routes, { initialUrl: '/rides', wrapper: createQueryWrapper(client) });
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('tab', { name: 'Карта' }));
    expect(await screen.findByTestId('map-area')).toBeOnTheScreen();

    listRideMap.mockRejectedValueOnce(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['rides', 'map'] });
    });
    expect(await screen.findByText('Повторить')).toBeOnTheScreen();
    expect(screen.getByTestId('map-area')).toBeOnTheScreen();
    expect(screen.getByTestId('ride-map-area')).toHaveStyle({ flex: 1 });

    await fireEvent.press(screen.getByText('Повторить'));
    await waitFor(() => expect(screen.queryByText('Повторить')).toBeNull());
    expect(screen.getByTestId('map-area')).toBeOnTheScreen();
  });
});
