// @vitest-environment jsdom
import { onlineManager } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { currentHref, httpError, ME, networkError, renderApp, unauthorized } from '../test/app';

vi.mock('../api', () => ({
  api: {
    me: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    health: vi.fn(),
    overview: vi.fn(),
    resendVerification: vi.fn(),
    listMembers: vi.fn(),
    listAudit: vi.fn(),
    listSeasons: vi.fn(),
    listCalendar: vi.fn(),
    getAppearance: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  mocked.health.mockResolvedValue({ status: 'ok', version: 'dev', checks: { database: 'up' } });
  mocked.overview.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const sidebar = () => screen.getByRole('complementary');

describe('каркас панели (AC10)', () => {
  it('после входа — сайдбар: бренд, «Обзор», внизу «Имя · Роль · команда платформы» и «Выйти»', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    await renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
    const side = within(sidebar());
    expect(side.getByText('Покатим')).toBeTruthy();
    expect(side.getByRole('link', { name: 'Обзор' }).getAttribute('aria-current')).toBe('page');
    expect(side.getByText('Ольга · Администратор · команда платформы')).toBeTruthy();
    expect(side.getByRole('button', { name: 'Выйти' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Требует внимания' })).toBeTruthy();
  });

  it.each([
    // admin-02: Гонки, Календарь, Сезоны (последним в основной группе); 06: «Споры» — сразу после «Гонок» (8.1
    // RC-18); admin-moderation-hub: «Модерация» (вкладки трёх очередей) — на месте «Модерации райдов», перед
    // «Оформлением приложения»
    [
      'admin',
      [
        'Обзор',
        'Гонки',
        'Споры',
        'Календарь',
        'Маршруты',
        'Сезоны',
        'Сотрудники',
        'Журнал действий',
        'Модерация',
        'Оформление приложения',
      ],
    ],
    // «Модерация» — при любом из прав rides/routes/profiles.moderate; у организатора их нет
    [
      'moderator',
      ['Обзор', 'Гонки', 'Споры', 'Маршруты', 'Сезоны', 'Журнал действий', 'Модерация'],
    ],
    ['organizer', ['Обзор', 'Гонки', 'Маршруты', 'Сезоны']],
  ] as const)('пункты меню по правам: %s', async (role, items) => {
    mocked.me.mockResolvedValue(ME[role]);
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Обзор' });
    const links = within(screen.getByRole('navigation')).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(items);
  });

  it.each([
    ['moderator', '/members'],
    ['organizer', '/members'],
    ['organizer', '/audit'],
    ['organizer', '/calendar'],
    ['organizer', '/rides-moderation'],
    ['organizer', '/disputes'],
    ['organizer', '/appearance'],
    ['organizer', '/rider-routes'],
    ['organizer', '/rider-profiles'],
    ['organizer', '/moderation'],
    ['moderator', '/appearance'],
    ['moderator', '/calendar'],
    ['moderator', '/races/new'],
  ] as const)(
    'прямой URL без права (%s → %s) — «Нет доступа к разделу» внутри каркаса, без запроса',
    async (role, path) => {
      mocked.me.mockResolvedValue(ME[role]);
      await renderApp(path);
      expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
      expect(screen.getByText('Обратитесь к администратору панели.')).toBeTruthy();
      expect(sidebar()).toBeTruthy();
      expect(mocked.listMembers).not.toHaveBeenCalled();
      expect(mocked.listAudit).not.toHaveBeenCalled();
      expect(mocked.listCalendar).not.toHaveBeenCalled();
      expect(mocked.listSeasons).not.toHaveBeenCalled();
      expect(mocked.getAppearance).not.toHaveBeenCalled();
    },
  );

  it('organizer — подпись роли «Организатор»', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/');
    expect(await screen.findByText('Ира · Организатор · команда платформы')).toBeTruthy();
  });

  it('неизвестный путь — «Страница не найдена» внутри каркаса со ссылкой на «Обзор»', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeTruthy();
    expect(sidebar()).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'К обзору' }));
    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
  });

  it('«Выйти» — выход на сервере, кэш очищен, «Вход в панель» без «Сессия истекла»', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    mocked.signOut.mockResolvedValue(undefined);
    const { router, queryClient } = await renderApp('/');
    await screen.findByRole('heading', { name: 'Обзор' });

    mocked.me.mockRejectedValue(unauthorized());
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(await screen.findByRole('heading', { name: 'Вход в панель' })).toBeTruthy();
    expect(mocked.signOut).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['admin', 'me'])).toBeUndefined();
    expect(screen.queryByText('Сессия истекла')).toBeNull();
    expect(currentHref(router)).toBe('/admin/sign-in');
  });

  it.each([
    ['сеть', networkError()],
    ['5xx', httpError(503, 'INTERNAL')],
  ])(
    'выход не удался (%s) — остаёмся в панели, кэш цел, баннер с повтором; повтор выходит',
    async (_case, failure) => {
      mocked.me.mockResolvedValue(ME.admin);
      mocked.signOut.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
      const { router, queryClient } = await renderApp('/');
      await screen.findByRole('heading', { name: 'Обзор' });

      fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

      expect(await screen.findByText('Не удалось выйти')).toBeTruthy();
      expect(screen.getByText('Сессия панели ещё активна. Повторите выход.')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Обзор' })).toBeTruthy();
      expect(currentHref(router)).toBe('/admin/');
      expect(queryClient.getQueryData(['admin', 'me'])).toEqual(ME.admin);

      mocked.me.mockRejectedValue(unauthorized());
      fireEvent.click(screen.getByRole('button', { name: 'Повторить выход' }));
      expect(await screen.findByRole('heading', { name: 'Вход в панель' })).toBeTruthy();
      expect(mocked.signOut).toHaveBeenCalledTimes(2);
      expect(queryClient.getQueryData(['admin', 'me'])).toBeUndefined();
    },
  );

  it('браузер без сети при открытии панели — не вечный скелетон, а «Нет соединения» с повтором', async () => {
    onlineManager.setOnline(false);
    mocked.me.mockRejectedValue(networkError());
    try {
      await renderApp('/');
      expect(await screen.findByText('Нет соединения')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('«кто я» не загрузился из-за сети — «Нет соединения» с повтором; повтор открывает панель', async () => {
    mocked.me.mockRejectedValue(networkError());
    await renderApp('/');
    expect(await screen.findByText('Нет соединения')).toBeTruthy();

    mocked.me.mockResolvedValue(ME.admin);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Обзор' })).toBeTruthy());
  });
});
