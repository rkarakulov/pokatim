/// <reference types="jest" />
import { ApiHttpError, ApiNetworkError } from '@pokatim/api-client';
import type { RideCard, RidePage } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { Text, type FlatList } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

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
