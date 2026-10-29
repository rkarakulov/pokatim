// @vitest-environment jsdom
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: { me: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), health: vi.fn(), overview: vi.fn() },
}));

const mocked = vi.mocked(api);
const ok = { status: 'ok' as const, version: 'dev', checks: { database: 'up' as const } };
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8057';

/** Ответ организатору: только протоколы и «Сейчас идёт». */
const ORGANIZER_OVERVIEW = {
  attention: { protocols: { awaiting: 0, checked: 0, ready: 0, blockers: 0 } },
  live: { racesTotal: 0, races: [], calendar: [] },
};

/** Ответ админу: все блоки. */
const ADMIN_OVERVIEW = {
  attention: {
    disputes: { open: 2 },
    protocols: { awaiting: 1, checked: 1, ready: 0, blockers: 3 },
    rides: { reported: 0 },
    riderRoutes: { pending: 4, reported: 0 },
    riderProfiles: { reported: 1 },
    accountDeletions: { stuck: 0 },
  },
  live: {
    racesTotal: 21,
    races: [
      {
        id: RACE_ID,
        title: 'Минское кольцо',
        windowEndsAt: '2026-10-26T20:59:00.000Z',
        participants: 12,
        attempts: 7,
      },
    ],
    calendar: [
      { id: RACE_ID, title: 'Гран-фондо', startsOn: '2026-11-01', endsOn: null, city: 'Гродно' },
    ],
  },
  kpi: { newUsers: 15, uploads: 42, activeRides: 6 },
};

/** Значение плитки по подписи. */
const tile = (label: string) => screen.getByRole('group', { name: label });

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
  mocked.overview.mockResolvedValue(ORGANIZER_OVERVIEW);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.resetAllMocks();
});

/** Статус API на «Обзоре» (перенесено из прежней заглушки `App.test.tsx`; AGENTS.md §4.12). */
describe('«Обзор» — статус API', () => {
  it('заголовок виден сразу, на загрузке — скелетон', async () => {
    mocked.health.mockReturnValue(new Promise(() => undefined));
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Загрузка' }).className).toContain('skeleton');
  });

  it('сетевая ошибка — сообщение о соединении и повтор', async () => {
    mocked.health.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(ok);
    await renderApp('/');
    expect(await screen.findByText(/Проверьте подключение к интернету/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Работает')).toBeTruthy();
  });

  it('статус — текстом словаря, а не кодом ответа', async () => {
    mocked.health.mockResolvedValueOnce({
      ...ok,
      status: 'degraded',
      checks: { database: 'down' },
    });
    await renderApp('/');
    expect(await screen.findByText('Работает с ограничениями')).toBeTruthy();
    expect(screen.queryByText('degraded')).toBeNull();
  });

  it('ошибка сервера и ответ неожиданной формы — «Сервис временно недоступен»', async () => {
    mocked.health.mockRejectedValueOnce(httpError(503, 'INTERNAL'));
    await renderApp('/');
    expect(await screen.findByText(/Сервис временно недоступен/)).toBeTruthy();
    cleanup();

    mocked.health.mockRejectedValueOnce(new Error('Invalid input'));
    await renderApp('/');
    expect(await screen.findByText(/Сервис временно недоступен/)).toBeTruthy();
  });

  it('ошибка обновления: значение остаётся, баннер «Данные могли устареть» с повтором', async () => {
    mocked.health
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(ok);
    const { queryClient } = await renderApp('/');
    expect(await screen.findByText('Работает')).toBeTruthy();

    await queryClient.refetchQueries({ queryKey: ['health'] }).catch(() => undefined);
    expect(await screen.findByText('Данные могли устареть')).toBeTruthy();
    expect(screen.getByText('Работает')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await vi.waitFor(() => expect(mocked.health).toHaveBeenCalledTimes(3));
  });

  it('нет сети до загрузки статуса (запрос на паузе) — «Нет соединения» с повтором; сеть вернулась — статус', async () => {
    mocked.health.mockReturnValue(new Promise(() => undefined));
    const { queryClient } = await renderApp('/');
    await screen.findByRole('heading', { name: 'Обзор' });

    mocked.health.mockResolvedValue(ok);
    onlineManager.setOnline(false);
    // перезапрос встаёт на паузу до возвращения сети — не ждём его
    act(() => void queryClient.resetQueries({ queryKey: ['health'] }));

    expect(await screen.findByText(/Проверьте подключение к интернету/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: 'Загрузка' })).toBeNull();

    act(() => onlineManager.setOnline(true));
    expect(await screen.findByText('Работает')).toBeTruthy();
  });
});

describe('«Обзор» — блоки по правам', () => {
  beforeEach(() => {
    mocked.health.mockResolvedValue(ok);
  });

  it('admin: карточки со ссылками, ноль — «Всё разобрано», «Сейчас идёт», KPI; статус API внизу', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    mocked.overview.mockResolvedValue(ADMIN_OVERVIEW);
    await renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Требует внимания' })).toBeTruthy();
    await vi.waitFor(() => expect(tile('Открытые споры').textContent).toContain('2'));
    expect(within(tile('Открытые споры')).getByRole('link', { name: 'Открыть' })).toBeTruthy();
    expect(tile('Ждут протокола').textContent).toContain('Готовы к публикации: 0 · блокеров: 3');
    expect(tile('Кофе-райды с жалобами').textContent).toContain('Всё разобрано');
    expect(within(tile('Кофе-райды с жалобами')).queryByRole('link')).toBeNull();
    expect(tile('Заявки в каталог').textContent).toContain('4');
    expect(
      within(tile('Профили с жалобами'))
        .getByRole('link', { name: 'Открыть' })
        .getAttribute('href'),
    ).toContain('/rider-profiles');
    expect(tile('Удаления аккаунтов со сбоем').textContent).toContain('Всё разобрано');

    const race = screen.getByRole('link', { name: 'Минское кольцо' });
    expect(race.getAttribute('href')).toContain(`/races/${RACE_ID}/results`);
    expect(screen.getByText('Показаны 1 из 21')).toBeTruthy();
    expect(screen.getByText('1 ноября 2026')).toBeTruthy();

    expect(tile('Новые пользователи').textContent).toContain('15');
    expect(tile('Загрузки заездов').textContent).toContain('42');
    expect(tile('Активные кофе-райды').textContent).toContain('6');

    // статус API — последним на странице
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Обзор',
      'Требует внимания',
      'Сейчас идёт',
      'Гонки с открытым окном',
      'Ближайшие старты календаря',
      'Платформа',
    ]);
    const status = screen.getByText('Статус API');
    const kpi = screen.getByRole('heading', { name: 'Платформа' });
    expect(kpi.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByText('Работает')).toBeTruthy();
  });

  it('ждущих гонок больше проверенных — подсказка «по N последним»; «Маршруты с жалобами» — вкладка жалоб', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    mocked.overview.mockResolvedValue({
      ...ADMIN_OVERVIEW,
      attention: {
        ...ADMIN_OVERVIEW.attention,
        protocols: { awaiting: 25, checked: 20, ready: 2, blockers: 30 },
        riderRoutes: { pending: 0, reported: 3 },
      },
    });
    await renderApp('/');
    await vi.waitFor(() => expect(tile('Ждут протокола').textContent).toContain('25'));
    expect(tile('Ждут протокола').textContent).toContain(
      'По 20 последним: готовы к публикации — 2 · блокеров: 30',
    );
    const link = within(tile('Маршруты с жалобами')).getByRole('link', { name: 'Открыть' });
    expect(link.getAttribute('href')).toContain('/rider-routes?tab=reported');
  });

  it('организатор: только «Ждут протокола» и «Сейчас идёт» — без модерации и KPI; пустые таблицы', async () => {
    await renderApp('/');
    await vi.waitFor(() => expect(tile('Ждут протокола').textContent).toContain('Всё разобрано'));
    expect(screen.queryByRole('group', { name: 'Открытые споры' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Платформа' })).toBeNull();
    expect(screen.getByText('Открытых окон нет')).toBeTruthy();
    expect(screen.getByText('Ближайших стартов нет')).toBeTruthy();
  });

  it('загрузка: заголовки видны, на месте чисел — скелетоны по правам сотрудника', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    mocked.overview.mockReturnValue(new Promise(() => undefined));
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Требует внимания' })).toBeTruthy();
    // модератор: споры, протоколы, райды, две карточки маршрутов, профили — без KPI и удалений
    expect(screen.getAllByTestId('skeleton-stat')).toHaveLength(6);
    expect(screen.queryByRole('heading', { name: 'Платформа' })).toBeNull();
  });

  it('ошибка без данных — «Не удалось загрузить» с повтором; статус API остаётся', async () => {
    mocked.overview
      .mockRejectedValueOnce(httpError(500, 'INTERNAL'))
      .mockResolvedValueOnce(ORGANIZER_OVERVIEW);
    await renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Сервис временно недоступен');
    expect(await screen.findByText('Работает')).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await vi.waitFor(() => expect(tile('Ждут протокола').textContent).toContain('Всё разобрано'));
  });

  it('ошибка обновления: данные остаются, баннер с повтором', async () => {
    mocked.overview
      .mockResolvedValueOnce(ORGANIZER_OVERVIEW)
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(ORGANIZER_OVERVIEW);
    const { queryClient } = await renderApp('/');
    await vi.waitFor(() => expect(tile('Ждут протокола').textContent).toContain('Всё разобрано'));

    await queryClient.refetchQueries({ queryKey: ['admin', 'overview'] }).catch(() => undefined);
    expect(await screen.findByText('Не удалось обновить обзор')).toBeTruthy();
    expect(tile('Ждут протокола').textContent).toContain('Всё разобрано');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await vi.waitFor(() => expect(mocked.overview).toHaveBeenCalledTimes(3));
  });
});
