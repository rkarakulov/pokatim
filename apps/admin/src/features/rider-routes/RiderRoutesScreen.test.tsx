// @vitest-environment jsdom
import type { RiderRouteModerationRow } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8070';
const AUTHOR = '01890a5d-ac96-774b-bcce-b302099a80a1';

const row = (overrides: Partial<RiderRouteModerationRow> = {}): RiderRouteModerationRow => ({
  id: ID,
  title: 'Вокруг Минского моря',
  authorUserId: AUTHOR,
  status: 'pending',
  city: 'minsk',
  surfaces: ['asphalt'],
  distanceM: 42_300,
  submittedAt: '2026-10-04T07:00:00.000Z',
  openReportCount: 0,
  topReason: null,
  lastReportAt: null,
  hiddenAt: null,
  ...overrides,
});

const cellsOf = (link: HTMLElement) =>
  within(link.closest('tr')!)
    .getAllByRole('cell')
    .map((item) => item.textContent?.replace(/\u00a0/g, ' '));

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.overview.mockReturnValue(new Promise(() => undefined));
  mocked.listRiderRoutes.mockResolvedValue({ items: [row()], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Маршруты райдеров» — очередь (routes-06, AC1, AC5)', () => {
  it('«На проверке» по умолчанию: маршрут (название + город), автор только id, длина, подана, статус; строка → заявка', async () => {
    const { router } = await renderApp('/rider-routes');
    expect(
      await screen.findByRole('heading', { name: 'Маршруты райдеров', level: 1 }),
    ).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Вокруг Минского моря' });
    expect(cellsOf(link)).toEqual([
      'Вокруг Минского моряМинск',
      'Райдер ·9a80a1',
      '42,3 км',
      '4 октября 2026, 10:00',
      'На проверке',
    ]);
    expect(mocked.listRiderRoutes).toHaveBeenCalledWith({ state: 'pending', limit: 50 });
    expect(screen.getByRole('button', { name: 'На проверке' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    mocked.getRiderRoute.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(link);
    await waitFor(() => expect(currentHref(router)).toBe(`/admin/rider-routes/${ID}`));
  });

  it('«Жалобы» — state=reported, число и главная причина; «Скрытые» — время скрытия; вкладка в URL', async () => {
    mocked.listRiderRoutes.mockResolvedValue({
      items: [
        row({
          status: 'approved',
          openReportCount: 2,
          topReason: 'private_area',
          lastReportAt: '2026-10-05T09:00:00.000Z',
        }),
      ],
      nextCursor: null,
    });
    const { router } = await renderApp('/rider-routes');
    fireEvent.click(await screen.findByRole('button', { name: 'Жалобы' }));
    await waitFor(() =>
      expect(mocked.listRiderRoutes).toHaveBeenCalledWith({ state: 'reported', limit: 50 }),
    );
    expect(currentHref(router)).toBe('/admin/rider-routes?tab=reported');
    const reported = await screen.findByRole('link', { name: 'Вокруг Минского моря' });
    expect(cellsOf(reported)[3]).toBe('2 · Частная или закрытая территория');
    expect(cellsOf(reported)[4]).toBe('В каталоге');

    mocked.listRiderRoutes.mockResolvedValue({
      items: [row({ status: 'hidden', hiddenAt: '2026-10-06T09:30:00.000Z' })],
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Скрытые' }));
    await waitFor(() => expect(currentHref(router)).toBe('/admin/rider-routes?tab=hidden'));
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Скрыт' })).toBeTruthy());
    const hidden = await screen.findByText('6 октября 2026, 12:30');
    expect(hidden).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Подана' })).toBeNull();
  });

  it('пустые состояния вкладок', async () => {
    mocked.listRiderRoutes.mockResolvedValue({ items: [], nextCursor: null });
    await renderApp('/rider-routes');
    expect(await screen.findByText('Заявок на проверке нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Жалобы' }));
    expect(await screen.findByText('Открытых жалоб нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Скрытые' }));
    expect(await screen.findByText('Скрытых маршрутов нет')).toBeTruthy();
  });

  it('загрузка — скелетон таблицы; ошибка — с повтором; 403 — «Нет доступа»', async () => {
    mocked.listRiderRoutes.mockReturnValue(new Promise(() => undefined));
    await renderApp('/rider-routes');
    expect((await screen.findAllByTestId('skeleton-row')).length).toBeGreaterThan(0);
    cleanup();

    mocked.listRiderRoutes.mockRejectedValue(httpError(500, 'INTERNAL'));
    await renderApp('/rider-routes');
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    cleanup();

    mocked.listRiderRoutes.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await renderApp('/rider-routes');
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
  });

  it('organizer (без routes.moderate) — нет пункта меню и «Нет доступа к разделу» без запроса', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/rider-routes');
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
    expect(
      within(screen.getByRole('navigation')).queryByRole('link', { name: 'Маршруты райдеров' }),
    ).toBeNull();
    expect(mocked.listRiderRoutes).not.toHaveBeenCalled();
    cleanup();

    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp(`/rider-routes/${ID}`);
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
    expect(mocked.getRiderRoute).not.toHaveBeenCalled();
  });
});
