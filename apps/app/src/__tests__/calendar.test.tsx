/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import type { CalendarPage, CalendarStartCard } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import type { RefreshControlProps } from 'react-native';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { createQueryWrapper } from './query-wrapper';

jest.mock('@/lib/api');

const listCalendar = jest.mocked(api.listCalendar);
const listCalendarMonths = jest.mocked(api.listCalendarMonths);
const listCalendarCities = jest.mocked(api.listCalendarCities);

/** «Сейчас»: 1 октября 2026, 15:00 по Минску. */
const NOW = new Date('2026-10-01T12:00:00Z');

let seq = 0;
const start = (overrides: Partial<CalendarStartCard> = {}): CalendarStartCard => ({
  id: `0190a6f4-0000-7000-8000-${String((seq += 1)).padStart(12, '0')}`,
  title: `Старт ${seq}`,
  startsOn: '2026-10-14',
  endsOn: null,
  startTime: null,
  discipline: 'road',
  city: 'Минск',
  distancesKm: [100],
  registrationUrl: null,
  phase: 'upcoming',
  ...overrides,
});

const page = (items: CalendarStartCard[], nextCursor: string | null = null): CalendarPage => ({
  items,
  nextCursor,
});
const never = () => new Promise<never>(() => undefined);

const hero = start({
  title: 'Минская сотка',
  distancesKm: [80, 120],
  registrationUrl: 'https://example.by/registration',
});
const nov = start({
  title: 'Гравий Нарочь',
  startsOn: '2026-11-07',
  discipline: 'gravel',
  city: 'Нарочь',
});
const multi = start({ title: 'Многодневка', startsOn: '2027-06-26', endsOn: '2027-06-27' });

const heroLabel = 'Ближайший старт. Минская сотка. 14 октября';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done' });
  listCalendar.mockResolvedValue(page([hero, nov, multi]));
  listCalendarMonths.mockResolvedValue({ months: ['2026-10', '2026-11', '2027-06'] });
  listCalendarCities.mockResolvedValue({ cities: ['Минск', 'Нарочь'] });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

const routes = {
  ...tabRoutes,
  'calendar/[id]': () => <Text>Карточка старта</Text>,
};
const openCalendar = () =>
  renderRouter(routes, { initialUrl: '/calendar', wrapper: createQueryWrapper() });
const feed = () => screen.getByTestId('calendar-feed');

describe('вкладка «Календарь» (AC3)', () => {
  it('шапка, лид и «Дисциплина» сразу; «Дата» и «Город» — скелетон ряда; на месте данных — скелетон', async () => {
    listCalendar.mockReturnValue(never());
    listCalendarMonths.mockReturnValue(never());
    listCalendarCities.mockReturnValue(never());
    await openCalendar();

    expect(screen.getByRole('header', { name: 'Календарь стартов' })).toBeOnTheScreen();
    expect(
      screen.getByText('Реальные старты сезона. Регистрация — у организаторов.'),
    ).toBeOnTheScreen();
    for (const chip of ['Шоссе', 'Гравий', 'МТБ']) {
      expect(screen.getByRole('button', { name: chip })).toBeOnTheScreen();
    }
    expect(screen.queryByRole('button', { name: 'Циклокросс' })).toBeNull();
    expect(screen.getByText('Дата')).toBeOnTheScreen();
    expect(screen.getByText('Город')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Загрузка').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
  });

  it('герой — первый старт, «Все старты» с подписями месяцев (всегда с годом); без скрытых блоков (AC7)', async () => {
    await openCalendar();

    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.getByText('80 и 120 км · Шоссе · Минск')).toBeOnTheScreen();
    expect(screen.getByText('До старта 13 дней.')).toBeOnTheScreen();
    expect(screen.getByText('Регистрация у организатора.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Все старты' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Ноябрь 2026' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Июнь 2027' })).toBeOnTheScreen();
    expect(
      screen.getByRole('link', { name: 'Гравий Нарочь. 7 ноября. 100 км · Гравий · Нарочь' }),
    ).toBeOnTheScreen();
    expect(screen.getByText('26–27')).toBeOnTheScreen();
    expect(screen.getByText('июня 2027')).toBeOnTheScreen();
    // чипы из данных
    for (const chip of ['Октябрь', 'Ноябрь', 'Июнь 2027', 'Минск', 'Нарочь']) {
      expect(screen.getByRole('button', { name: chip })).toBeOnTheScreen();
    }
    expect(listCalendar).toHaveBeenCalledWith({ discipline: [], city: [], month: [], limit: 20 });
    for (const hidden of [
      /Найдено/,
      'Регистрация открыта',
      'Фото и видео',
      /Комментари/,
      'Войти',
    ]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
  });

  it('строка и герой ведут в карточку /calendar/<id>', async () => {
    const router = await openCalendar();
    await fireEvent.press(await screen.findByRole('link', { name: heroLabel }));
    expect(router.getPathname()).toBe(`/calendar/${hero.id}`);
  });

  it('строка списка ведёт в карточку', async () => {
    const router = await openCalendar();
    await fireEvent.press(
      await screen.findByRole('link', {
        name: 'Гравий Нарочь. 7 ноября. 100 км · Гравий · Нарочь',
      }),
    );
    expect(router.getPathname()).toBe(`/calendar/${nov.id}`);
  });

  it('чипы перезапрашивают с discipline/city/month, скелетон на месте данных; «Сбросить фильтры» снимает все', async () => {
    await openCalendar();
    await screen.findByRole('link', { name: heroLabel });
    listCalendar.mockClear();
    listCalendar.mockReturnValue(never());

    await fireEvent.press(screen.getByRole('button', { name: 'Гравий' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Нарочь' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ноябрь' }));

    expect(screen.getByRole('button', { name: 'Гравий' })).toBeSelected();
    expect(listCalendar).toHaveBeenLastCalledWith({
      discipline: ['gravel'],
      city: ['Нарочь'],
      month: ['2026-11'],
      limit: 20,
    });
    expect(screen.getByLabelText('Загрузка')).toBeOnTheScreen();
    expect(screen.queryByRole('link', { name: heroLabel })).toBeNull();

    listCalendar.mockResolvedValue(page([hero]));
    await fireEvent.press(screen.getByText('Сбросить фильтры'));
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Гравий' })).not.toBeSelected();
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
  });

  it('без совпадений — «Ничего не найдено» + сброс; герой «Ближайший по фильтрам»', async () => {
    await openCalendar();
    await screen.findByRole('link', { name: heroLabel });
    listCalendar.mockImplementation((params = {}) =>
      Promise.resolve(page(params.discipline?.includes('mtb') ? [] : [hero])),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'МТБ' }));
    expect(await screen.findByText('Ничего не найдено')).toBeOnTheScreen();
    expect(screen.getByText('Нет стартов по выбранным фильтрам.')).toBeOnTheScreen();
    const resets = screen.getAllByRole('button', { name: 'Сбросить фильтры' });
    await fireEvent.press(resets[1]!);
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Шоссе' }));
    expect(
      await screen.findByLabelText('Ближайший по фильтрам. Минская сотка. 14 октября'),
    ).toBeOnTheScreen();
  });

  it('пусто без фильтров — «Пока нет стартов в календаре»', async () => {
    listCalendar.mockResolvedValue(page([]));
    await openCalendar();
    expect(await screen.findByText('Пока нет стартов в календаре')).toBeOnTheScreen();
  });

  it('ошибка months и cities — группы скрыты, список работает', async () => {
    listCalendarMonths.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    listCalendarCities.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openCalendar();

    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Дата')).toBeNull());
    expect(screen.queryByText('Город')).toBeNull();
    expect(screen.getByText('Дисциплина')).toBeOnTheScreen();
  });

  it('выбранный месяц, которого больше нет в ответе months, снимается молча', async () => {
    const view = await openCalendar();
    await screen.findByRole('link', { name: heroLabel });
    await fireEvent.press(screen.getByRole('button', { name: 'Октябрь' }));
    expect(listCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ month: ['2026-10'] }));

    listCalendarMonths.mockResolvedValue({ months: ['2026-11', '2027-06'] });
    const control = () => feed().props.refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      control().props.onRefresh?.();
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Октябрь' })).toBeNull());
    // ключ без месяца — выдача без фильтров (из свежего кэша); чип снят, сброса нет
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.queryByText('Сбросить фильтры')).toBeNull();
    view.unmount();
  });

  it('подгрузка у конца по курсору; ошибка догрузки — баннер в подвале, данные остаются', async () => {
    const more = start({ title: 'Вторая страница', startsOn: '2026-12-05' });
    listCalendar.mockImplementation((params = {}) =>
      Promise.resolve(params.cursor ? page([more]) : page([hero, nov], 'c2')),
    );
    await openCalendar();
    await screen.findByText('Гравий Нарочь');

    await act(async () => {
      feed().props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(await screen.findByText('Вторая страница')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Декабрь 2026' })).toBeOnTheScreen();
    expect(listCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c2' }));
  });

  it('конец списка во время обновления не отменяет refetch: обновлённая первая страница сохраняется (ревью pass 1)', async () => {
    listCalendar.mockImplementation((params = {}) =>
      Promise.resolve(params.cursor ? page([start({ title: 'Вторая' })]) : page([hero, nov], 'c2')),
    );
    await openCalendar();
    await screen.findByText('Гравий Нарочь');

    let release: (value: CalendarPage) => void = () => undefined;
    const updated = start({ title: 'Обновлённый старт', startsOn: '2026-11-20' });
    listCalendar.mockImplementation((params = {}) =>
      params.cursor
        ? Promise.resolve(page([start({ title: 'Вторая' })]))
        : new Promise<CalendarPage>((resolve) => {
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
    // догрузка не стартует, пока идёт обновление
    expect(listCalendar).not.toHaveBeenCalledWith(expect.objectContaining({ cursor: 'c2' }));

    await act(async () => {
      release(page([hero, nov, updated], 'c2'));
    });
    expect(await screen.findByText('Обновлённый старт')).toBeOnTheScreen();
  });

  it('ошибка догрузки — «Не удалось загрузить» в подвале, загруженное остаётся; повтор', async () => {
    listCalendar.mockImplementation((params = {}) =>
      params.cursor
        ? Promise.reject(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }))
        : Promise.resolve(page([hero, nov], 'c2')),
    );
    await openCalendar();
    await screen.findByText('Гравий Нарочь');

    await act(async () => {
      feed().props.onEndReached?.({ distanceFromEnd: 0 });
    });
    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByText('Гравий Нарочь')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: heroLabel })).toBeOnTheScreen();
    expect(screen.queryByText('Данные могли устареть')).toBeNull();

    listCalendar.mockResolvedValue(page([start({ title: 'Догружен', startsOn: '2026-12-01' })]));
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByText('Догружен')).toBeOnTheScreen();
  });

  it('даты по Минску в TZ ≠ Минск: 30 сентября 21:30 UTC — уже 1 октября', async () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      jest.setSystemTime(new Date('2026-09-30T21:30:00Z'));
      listCalendar.mockResolvedValue(page([start({ title: 'Сегодня', startsOn: '2026-10-01' })]));
      await openCalendar();
      expect(await screen.findByText('Старт сегодня.')).toBeOnTheScreen();
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('вкладка «Календарь»: состояния (AC6)', () => {
  it('ошибка сервера без данных — «Не удалось загрузить» + «Повторить», чипы на месте', async () => {
    listCalendar.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await openCalendar();

    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Шоссе' })).toBeOnTheScreen();
    listCalendar.mockResolvedValue(page([hero]));
    await fireEvent.press(screen.getByText('Повторить'));
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('офлайн-старт — «Нет соединения» сразу; сеть вернулась — данные', async () => {
    onlineManager.setOnline(false);
    await openCalendar();

    expect(await screen.findByText('Нет соединения')).toBeOnTheScreen();
    expect(listCalendar).not.toHaveBeenCalled();
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(await screen.findByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('pull-to-refresh перезапрашивает список, месяцы и города; индикатор — на время жеста; ошибка — баннер при данных', async () => {
    await openCalendar();
    await screen.findByRole('link', { name: heroLabel });
    expect(listCalendar).toHaveBeenCalledTimes(1);

    const control = () => feed().props.refreshControl as ReactElement<RefreshControlProps>;
    await act(async () => {
      control().props.onRefresh?.();
    });
    await waitFor(() => expect(listCalendar).toHaveBeenCalledTimes(2));
    expect(listCalendarMonths).toHaveBeenCalledTimes(2);
    expect(listCalendarCities).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(control().props.refreshing).toBe(false));

    listCalendar.mockRejectedValue(new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }));
    await act(async () => {
      control().props.onRefresh?.();
    });
    expect(await screen.findByText('Данные могли устареть')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });

  it('без сети при показанных данных — баннер «Нет соединения», данные остаются', async () => {
    await openCalendar();
    await screen.findByRole('link', { name: heroLabel });
    await act(async () => {
      onlineManager.setOnline(false);
    });
    expect(screen.getByText('Нет соединения')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: heroLabel })).toBeOnTheScreen();
  });
});
