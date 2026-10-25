/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { RaceCard, RacePage } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const listRaces = jest.mocked(api.listRaces);
const getCurrentSeason = jest.mocked(api.getCurrentSeason);
const listSeasons = jest.mocked(api.listSeasons);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');

let seq = 0;
const race = (overrides: Partial<RaceCard> = {}): RaceCard => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`,
  title: `Гонка ${seq}`,
  bikeClass: 'gravel',
  surfaces: ['gravel'],
  distanceKm: 62,
  // 4 октября 00:00 — 12 октября 23:59 по Минску
  windowStartsAt: '2026-10-03T21:00:00Z',
  windowEndsAt: '2026-10-12T20:59:00Z',
  protocolPlannedAt: '2026-10-14T09:00:00Z',
  phase: 'upcoming',
  cancelReason: null,
  season: null,
  ...overrides,
});

const page = (items: RaceCard[], nextCursor: string | null = null): RacePage => ({
  items,
  nextCursor,
});
const never = () => new Promise<never>(() => undefined);

const hero = race({ title: 'Гравийный коридор Логойск' });
const soon = race({
  title: 'Шоссейная петля',
  bikeClass: 'road',
  surfaces: ['asphalt'],
  windowStartsAt: '2026-10-16T21:00:00Z',
  windowEndsAt: '2026-10-24T20:59:00Z',
});
const closed = race({
  title: 'Гравий Дзержинск',
  phase: 'closed',
  windowStartsAt: '2026-09-11T21:00:00Z',
  windowEndsAt: '2026-09-20T20:59:00Z',
  protocolPlannedAt: '2026-09-29T09:00:00Z',
});
const cancelled = race({
  title: 'Отменённый МТБ',
  bikeClass: 'mtb',
  phase: 'cancelled',
  cancelReason: 'weather',
});

/** Ответ API по scope; `current` и `past` — по одной странице. */
function serve(current: RaceCard[], past: RaceCard[]) {
  listRaces.mockImplementation((params = {}) =>
    Promise.resolve(page(params.scope === 'past' ? past : current)),
  );
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  getCurrentSeason.mockResolvedValue({ season: null });
  listSeasons.mockResolvedValue({ items: [] });
  serve([hero, soon], [closed, cancelled]);
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const openRaces = () =>
  renderRouter(tabRoutes, { initialUrl: '/races', wrapper: createQueryWrapper() });
const feed = () => screen.getByTestId('races-feed');
const heroLabel = 'Ближайшая гонка. Гравийный коридор Логойск. 4–12 октября';

describe('вкладка «Гонки» (AC3)', () => {
  it('шапка и чипы сразу, на месте данных — скелетоны героя и карточек', async () => {
    listRaces.mockReturnValue(never());
    await openRaces();

    expect(screen.getByRole('header', { name: 'Гонки' })).toBeOnTheScreen();
    for (const chip of ['Шоссе', 'ТТ', 'Гравий', 'МТБ', 'Октябрь', 'Ноябрь', 'Декабрь']) {
      expect(screen.getByRole('button', { name: chip })).toBeOnTheScreen();
    }
    expect(screen.getByText('Класс')).toBeOnTheScreen();
    expect(screen.getByText('Дата')).toBeOnTheScreen();
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
  });

  it('герой — первая current-гонка (даты по Минску), «Скоро», затем «Завершённые» после current; без скрытых блоков (AC3, AC9)', async () => {
    await openRaces();

    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(
      screen.getByText('62 км · класс «Гравий». Окно: 4–12 октября, до 23:59.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Окно откроется 4 октября, 00:00, закроется 12 октября в 23:59.'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('Завершённые')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Все гонки' })).toBeOnTheScreen();
    expect(screen.getByText('Скоро')).toBeOnTheScreen();
    expect(screen.getByText('Шоссейная петля')).toBeOnTheScreen();
    // плановая дата протокола (29.09) уже прошла по часам клиента — «ожидается» (Q9)
    expect(screen.getByText('Окно закрыто. Протокол ожидается')).toBeOnTheScreen();
    expect(
      screen.getByText('Гонка отменена. Причина: Неблагоприятные погодные условия.'),
    ).toBeOnTheScreen();
    // past — после current, публичные запросы без токена
    expect(listRaces.mock.calls.map(([params]) => params)).toEqual([
      { scope: 'current', bikeClass: [], month: [], limit: 20 },
      { scope: 'past', bikeClass: [], month: [], limit: 20 },
    ]);
    for (const hidden of [
      'Участвовать',
      'Таблица сезона',
      /Найдено/,
      /Проедьте коридор/,
      /Verified/,
      'Загрузить заезд',
    ]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
  });

  it('чипы класса и месяца перезапрашивают с bikeClass/month, скелетон на месте данных; «Сбросить фильтры» снимает все', async () => {
    await openRaces();
    await screen.findByRole('link', { name: heroLabel });
    listRaces.mockClear();
    listRaces.mockReturnValue(never());

    await fireEvent.press(screen.getByRole('button', { name: 'МТБ' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ноябрь' }));

    expect(screen.getByRole('button', { name: 'МТБ' })).toBeSelected();
    expect(listRaces).toHaveBeenLastCalledWith({
      scope: 'current',
      bikeClass: ['mtb'],
      month: ['2026-11'],
      limit: 20,
    });
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: heroLabel })).toBeNull();

    serve([hero], []);
    await fireEvent.press(screen.getByText('Сбросить фильтры'));
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'МТБ' })).not.toBeSelected();
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
  });

  it('без совпадений по фильтрам — «Ничего не найдено» + текст по фильтрам + сброс; герой «по фильтрам»', async () => {
    await openRaces();
    await screen.findByRole('link', { name: heroLabel });
    listRaces.mockImplementation((params = {}) =>
      Promise.resolve(page(params.bikeClass?.length ? [] : [hero])),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'МТБ' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Октябрь' }));

    expect(await screen.findByText('Ничего не найдено')).toBeOnTheScreen();
    expect(screen.getByText('Нет гонок класса «МТБ» в октябре.')).toBeOnTheScreen();
    // действие пустого состояния (строка «Сбросить фильтры» над героем — тоже есть)
    const resets = screen.getAllByRole('button', { name: 'Сбросить фильтры' });
    expect(resets).toHaveLength(2);
    await fireEvent.press(resets[1]!);
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();

    listRaces.mockImplementation((params = {}) =>
      Promise.resolve(page(params.scope === 'current' ? [hero] : [])),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Гравий' }));
    expect(
      await screen.findByLabelText(
        'Ближайшая по фильтрам. Гравийный коридор Логойск. 4–12 октября',
      ),
    ).toBeOnTheScreen();
  });

  it('пусто без фильтров — пустой герой + «Календарь стартов» → вкладка «Календарь»; ниже — «Завершённые»', async () => {
    serve([], [closed]);
    const router = await openRaces();

    expect(await screen.findByText('Пока нет открытых гонок')).toBeOnTheScreen();
    expect(await screen.findByText('Завершённые')).toBeOnTheScreen();
    expect(screen.queryByText('Скоро')).toBeNull();
    await fireEvent.press(screen.getByText('Календарь стартов'));
    expect(router.getPathname()).toBe('/calendar');
  });

  it('подгрузка у конца: сначала страницы current по курсору, затем past; ошибка догрузки — баннер в подвале, данные остаются', async () => {
    const more = race({ title: 'Вторая страница' });
    listRaces.mockImplementation((params = {}) => {
      if (params.scope === 'past') return Promise.resolve(page([closed], 'p2'));
      return Promise.resolve(params.cursor ? page([more]) : page([hero, soon], 'c2'));
    });
    await openRaces();
    await screen.findByText('Шоссейная петля');
    // past не запрашивается, пока у current есть страницы
    expect(listRaces).toHaveBeenCalledTimes(1);

    await act(async () => {
      feed().props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(await screen.findByText('Вторая страница')).toBeOnTheScreen();
    expect(listRaces).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'current', cursor: 'c2' }),
    );
    expect(await screen.findByText('Гравий Дзержинск')).toBeOnTheScreen();

    listRaces.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await act(async () => {
      feed().props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(listRaces).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'past', cursor: 'p2' }),
    );
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByText('Гравий Дзержинск')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: heroLabel })).toBeOnTheScreen();
    // баннер — в подвале: «Данные могли устареть» над героем не показывается
    expect(screen.queryByText('Данные могли устареть')).toBeNull();

    listRaces.mockResolvedValue(page([cancelled]));
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByText('Отменённый МТБ')).toBeOnTheScreen();
    expect(screen.queryByText('Не удалось загрузить')).toBeNull();
  });
});

describe('вкладка «Гонки»: догрузка во время обновления (ревью pass 1 блока 04)', () => {
  it('конец списка во время refetch current не отменяет его: обновлённая первая страница сохраняется', async () => {
    listRaces.mockImplementation((params = {}) =>
      Promise.resolve(
        params.scope === 'past'
          ? page([])
          : params.cursor
            ? page([closed])
            : page([hero, soon], 'c2'),
      ),
    );
    await openRaces();
    await screen.findByText('Шоссейная петля');

    let release: (value: RacePage) => void = () => undefined;
    const updated = race({ title: 'Обновлённая гонка' });
    listRaces.mockImplementation((params = {}) =>
      params.cursor || params.scope === 'past'
        ? Promise.resolve(page([closed]))
        : new Promise<RacePage>((resolve) => {
            release = resolve;
          }),
    );
    const control = () => feed().props.refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      control().props.onRefresh?.();
    });
    await act(async () => {
      feed().props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(listRaces).not.toHaveBeenCalledWith(expect.objectContaining({ cursor: 'c2' }));

    await act(async () => {
      release(page([hero, soon, updated], 'c2'));
    });
    expect(await screen.findByText('Обновлённая гонка')).toBeOnTheScreen();
  });
});

describe('вкладка «Гонки»: состояния (AC8)', () => {
  it('ошибка сервера без данных — «Не удалось загрузить» + «Повторить», чипы на месте', async () => {
    listRaces.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openRaces();

    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Гравий' })).toBeOnTheScreen();
    serve([hero], []);
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('офлайн-старт — «Нет соединения» сразу; сеть вернулась — данные без действий', async () => {
    onlineManager.setOnline(false);
    await openRaces();

    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    expect(listRaces).not.toHaveBeenCalled();
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('pull-to-refresh перезапрашивает current и past; индикатор — только на время жеста; ошибка обновления — баннер при данных', async () => {
    await openRaces();
    await screen.findByText('Завершённые');
    expect(listRaces).toHaveBeenCalledTimes(2);

    const control = () => feed().props.refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      control().props.onRefresh?.();
    });
    await waitFor(() => expect(listRaces).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(control().props.refreshing).toBe(false));

    listRaces.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await act(async () => {
      control().props.onRefresh?.();
    });
    expect(await screen.findByText('Данные могли устареть')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('ошибка фонового обновления past при данных — «Завершённые» остаются, баннер с повтором past (ревью pass 1)', async () => {
    await openRaces();
    await screen.findByText('Гравий Дзержинск');

    listRaces.mockImplementation((params = {}) =>
      params.scope === 'past'
        ? Promise.reject(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }))
        : Promise.resolve(page([hero, soon])),
    );
    const control = () => feed().props.refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      control().props.onRefresh?.();
    });

    expect(await screen.findByText('Данные могли устареть')).toBeOnTheScreen();
    expect(screen.getByText('Гравий Дзержинск')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: heroLabel })).toBeOnTheScreen();

    serve([hero, soon], [closed, cancelled, race({ title: 'Новая завершённая' })]);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Новая завершённая')).toBeOnTheScreen();
    expect(screen.queryByText('Данные могли устареть')).toBeNull();
    expect(listRaces).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'past' }));
  });

  it('без сети при показанных данных — баннер «Нет соединения», данные остаются (ревью pass 1)', async () => {
    await openRaces();
    await screen.findByRole('link', { name: heroLabel });
    expect(screen.queryByText('Нет соединения')).toBeNull();

    await act(async () => {
      onlineManager.setOnline(false);
    });
    expect(screen.getByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });
});

describe('вкладка «Гонки»: месяцы фильтра (ревью pass 1)', () => {
  it('полночь на смене месяца: выбранный месяц, которого больше нет среди чипов, снимается с запроса', async () => {
    // 31 октября 23:58 по Минску
    jest.setSystemTime(new Date('2026-10-31T20:58:00Z'));
    await openRaces();
    await screen.findByRole('link', { name: heroLabel });

    await fireEvent.press(screen.getByRole('button', { name: 'Октябрь' }));
    expect(listRaces).toHaveBeenLastCalledWith(expect.objectContaining({ month: ['2026-10'] }));
    expect(screen.getByText('Сбросить фильтры')).toBeOnTheScreen();

    await act(() => jest.advanceTimersByTimeAsync(3 * 60_000));

    expect(screen.queryByRole('button', { name: 'Октябрь' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Январь 2027' })).toBeOnTheScreen();
    await waitFor(() =>
      expect(listRaces).toHaveBeenLastCalledWith(expect.objectContaining({ month: [] })),
    );
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
  });
});
