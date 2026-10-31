// @vitest-environment jsdom
import { onlineManager } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

describe('«Обзор» — блоки по правам', () => {
  beforeEach(() => {
    mocked.health.mockResolvedValue(ok);
  });

  it('2FA не подключена — баннер рекомендации со ссылкой на «Безопасность»; подключена — баннера нет', async () => {
    mocked.me.mockResolvedValue({
      ...ME.organizer,
      user: { ...ME.organizer.user, totp: { enabled: false, required: false } },
    });
    mocked.overview.mockResolvedValue(ADMIN_OVERVIEW);
    await renderApp('/');
    expect(await screen.findByText('Подключите двухфакторную защиту')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Перейти в «Безопасность»' }).getAttribute('href'),
    ).toBe('/admin/account/security');
    cleanup();

    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Обзор' });
    expect(screen.queryByText('Подключите двухфакторную защиту')).toBeNull();
  });

  it('admin: карточки со ссылками, ноль — «Всё разобрано», «Сейчас идёт», KPI; статуса API нет', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    mocked.overview.mockResolvedValue(ADMIN_OVERVIEW);
    await renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Требует внимания' })).toBeTruthy();
    await waitFor(() => expect(tile('Открытые споры').textContent).toContain('2'));
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
    expect(within(tile('Удаления аккаунтов со сбоем')).queryByRole('link')).toBeNull();

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
  });

  it('ждущих гонок больше проверенных — подсказка «по N последним»; «Маршруты с жалобами» — вкладка жалоб', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    mocked.overview.mockResolvedValue({
      ...ADMIN_OVERVIEW,
      attention: {
        ...ADMIN_OVERVIEW.attention,
        protocols: { awaiting: 25, checked: 20, ready: 2, blockers: 30 },
        riderRoutes: { pending: 0, reported: 3 },
        accountDeletions: { stuck: 2 },
      },
    });
    await renderApp('/');
    await waitFor(() => expect(tile('Ждут протокола').textContent).toContain('25'));
    expect(tile('Ждут протокола').textContent).toContain(
      'По 20 последним: готовы к публикации — 2 · блокеров: 30',
    );
    const link = within(tile('Маршруты с жалобами')).getByRole('link', { name: 'Открыть' });
    expect(link.getAttribute('href')).toContain('/rider-routes?tab=reported');
    // erasure-failures: зависшие удаления — ссылка на экран сбоев
    expect(
      within(tile('Удаления аккаунтов со сбоем'))
        .getByRole('link', { name: 'Открыть' })
        .getAttribute('href'),
    ).toContain('/account-erasures');
  });

  it('организатор: только «Ждут протокола» и «Сейчас идёт» — без модерации и KPI; пустые таблицы', async () => {
    await renderApp('/');
    await waitFor(() => expect(tile('Ждут протокола').textContent).toContain('Всё разобрано'));
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

  it('ошибка без данных — «Не удалось загрузить» с повтором', async () => {
    mocked.overview
      .mockRejectedValueOnce(httpError(500, 'INTERNAL'))
      .mockResolvedValueOnce(ORGANIZER_OVERVIEW);
    await renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Сервис временно недоступен');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(tile('Ждут протокола').textContent).toContain('Всё разобрано'));
  });

  it('ошибка обновления: данные остаются, баннер с повтором', async () => {
    mocked.overview
      .mockResolvedValueOnce(ORGANIZER_OVERVIEW)
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(ORGANIZER_OVERVIEW);
    const { queryClient } = await renderApp('/');
    await waitFor(() => expect(tile('Ждут протокола').textContent).toContain('Всё разобрано'));

    await queryClient.refetchQueries({ queryKey: ['admin', 'overview'] }).catch(() => undefined);
    expect(await screen.findByText('Не удалось обновить обзор')).toBeTruthy();
    expect(tile('Ждут протокола').textContent).toContain('Всё разобрано');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(mocked.overview).toHaveBeenCalledTimes(3));
  });
});
