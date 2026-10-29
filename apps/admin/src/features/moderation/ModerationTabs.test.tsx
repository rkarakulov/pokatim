// @vitest-environment jsdom
import type { PanelMe, PanelOverview, Permission } from '@pokatim/contracts';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    overview: vi.fn(),
    listRiderRoutes: vi.fn(),
    getRiderRoute: vi.fn(),
    listRiderProfiles: vi.fn(),
    listModerationRides: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8070';

const withPermissions = (permissions: Permission[]): PanelMe => ({
  ...ME.moderator,
  permissions,
});

const overview = (attention: PanelOverview['attention']): PanelOverview => ({ attention });

const sidebarLink = (name: string) =>
  within(screen.getByRole('complementary')).getByRole('link', { name });
const tabs = () => screen.getByRole('navigation', { name: 'Очереди модерации' });
const tabNames = () =>
  within(tabs())
    .getAllByRole('link')
    .map((link) => link.textContent);
const currentTab = () =>
  within(tabs())
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent);

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.overview.mockReturnValue(new Promise(() => undefined));
  mocked.listRiderRoutes.mockResolvedValue({ items: [], nextCursor: null });
  mocked.listRiderProfiles.mockResolvedValue({ items: [], nextCursor: null });
  mocked.listModerationRides.mockResolvedValue({ items: [], nextCursor: null });
  mocked.getRiderRoute.mockReturnValue(new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Модерация» — вкладки по типу контента (admin-moderation-hub)', () => {
  it.each([
    ['/rider-routes', 'Маршруты райдеров'],
    ['/rider-routes?tab=reported', 'Маршруты райдеров'],
    ['/rider-profiles', 'Профили райдеров'],
    ['/rides-moderation', 'Кофе-райды'],
    ['/rides-moderation?state=hidden', 'Кофе-райды'],
  ])(
    '%s — вкладки по порядку, текущая отмечена, пункт сайдбара «Модерация» подсвечен',
    async (path, current) => {
      await renderApp(path);
      expect(await screen.findByRole('navigation', { name: 'Очереди модерации' })).toBeTruthy();
      expect(tabNames()).toEqual(['Маршруты райдеров', 'Профили райдеров', 'Кофе-райды']);
      expect(currentTab()).toEqual([current]);
      expect(sidebarLink('Модерация').getAttribute('aria-current')).toBe('page');
    },
  );

  it('ссылки вкладок — существующие адреса разделов', async () => {
    await renderApp('/rider-profiles');
    await screen.findByRole('navigation', { name: 'Очереди модерации' });
    expect(
      within(tabs())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/admin/rider-routes', '/admin/rider-profiles', '/admin/rides-moderation']);
  });

  it('только вкладки разрешённых очередей', async () => {
    mocked.me.mockResolvedValue(withPermissions(['profiles.moderate', 'rides.moderate']));
    await renderApp('/rides-moderation');
    await screen.findByRole('navigation', { name: 'Очереди модерации' });
    expect(tabNames()).toEqual(['Профили райдеров', 'Кофе-райды']);
  });

  it('счётчики из «Обзора»: маршруты — заявки и жалобы вместе; ноль — без счётчика', async () => {
    mocked.overview.mockResolvedValue(
      overview({
        riderRoutes: { pending: 2, reported: 1 },
        riderProfiles: { reported: 0 },
        rides: { reported: 4 },
      }),
    );
    await renderApp('/rider-routes');
    expect(
      await within(await screen.findByRole('navigation', { name: 'Очереди модерации' })).findByRole(
        'link',
        { name: 'Маршруты райдеров ждут решения: 3' },
      ),
    ).toBeTruthy();
    expect(within(tabs()).getByRole('link', { name: 'Кофе-райды ждут решения: 4' })).toBeTruthy();
    expect(within(tabs()).getByRole('link', { name: 'Профили райдеров' })).toBeTruthy();
    // число видно на вкладке, скринридер слышит подпись
    expect(within(tabs()).getByText('3').getAttribute('aria-hidden')).toBe('true');
  });

  it('«Обзор» не ответил — вкладки без счётчиков, экран раздела работает', async () => {
    mocked.overview.mockRejectedValue(httpError(503, 'INTERNAL'));
    await renderApp('/rider-profiles');
    expect(await screen.findByText('Жалоб нет')).toBeTruthy();
    expect(tabNames()).toEqual(['Маршруты райдеров', 'Профили райдеров', 'Кофе-райды']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('карточка заявки — без вкладок, пункт «Модерация» подсвечен', async () => {
    await renderApp(`/rider-routes/${ID}`);
    expect(sidebarLink('Модерация').getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('navigation', { name: 'Очереди модерации' })).toBeNull();
  });

  it('вне модерации пункт «Модерация» не подсвечен', async () => {
    await renderApp('/');
    expect(sidebarLink('Модерация').getAttribute('aria-current')).toBeNull();
  });
});

describe('«/moderation» — первая доступная очередь', () => {
  it.each([
    [['routes.moderate', 'profiles.moderate', 'rides.moderate'], '/admin/rider-routes'],
    [['profiles.moderate', 'rides.moderate'], '/admin/rider-profiles'],
    [['rides.moderate'], '/admin/rides-moderation'],
  ] as const)('права %j → %s', async (permissions, href) => {
    mocked.me.mockResolvedValue(withPermissions([...permissions]));
    const { router } = await renderApp('/moderation');
    await screen.findByRole('navigation', { name: 'Очереди модерации' });
    expect(currentHref(router)).toBe(href);
  });

  it('ни одного права модерации — «Нет доступа к разделу», без запросов очередей', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/moderation');
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
    expect(
      within(screen.getByRole('complementary')).queryByRole('link', { name: 'Модерация' }),
    ).toBeNull();
    expect(mocked.listRiderRoutes).not.toHaveBeenCalled();
    expect(mocked.listRiderProfiles).not.toHaveBeenCalled();
    expect(mocked.listModerationRides).not.toHaveBeenCalled();
  });

  it('пункт «Модерация» виден при любом одном праве из трёх и ведёт в раздел', async () => {
    for (const permission of ['routes.moderate', 'profiles.moderate', 'rides.moderate'] as const) {
      mocked.me.mockResolvedValue(withPermissions([permission]));
      await renderApp('/');
      expect(sidebarLink('Модерация').getAttribute('href')).toBe('/admin/moderation');
      cleanup();
    }
  });
});
