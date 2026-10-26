// @vitest-environment jsdom
import type { ModerationRideRow } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listModerationRides: vi.fn(),
    getModerationRide: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8070';
const OTHER = '01890a5d-ac96-774b-bcce-b302099a8071';

const row = (overrides: Partial<ModerationRideRow> = {}): ModerationRideRow => ({
  id: ID,
  title: 'Кофе-райд на море',
  city: 'minsk',
  startsAt: '2026-10-04T07:00:00.000Z',
  status: 'published',
  phase: 'upcoming',
  openReportCount: 3,
  topReason: 'offensive',
  lastReportAt: '2026-10-01T10:00:00.000Z',
  hiddenAt: null,
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.listModerationRides.mockResolvedValue({ items: [row()], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Модерация райдов» — очередь (05b, AC3, AC8)', () => {
  it('открытые жалобы: райд (название + город), старт, жалобы с главной причиной, статус; строка → карточка', async () => {
    const { router } = await renderApp('/rides-moderation');
    expect(await screen.findByRole('heading', { name: 'Модерация райдов' })).toBeTruthy();
    const cell = await screen.findByRole('link', { name: 'Кофе-райд на море' });
    const tr = cell.closest('tr')!;
    const cells = within(tr)
      .getAllByRole('cell')
      .map((item) => item.textContent);
    expect(cells).toEqual([
      'Кофе-райд на мореМинск',
      '4 октября 2026, 10:00',
      '3 · Оскорбления или неприемлемый текст',
      'Опубликован',
    ]);
    expect(mocked.listModerationRides).toHaveBeenCalledWith({ state: 'open', limit: 50 });
    expect(
      screen.getByRole('button', { name: 'Открытые жалобы' }).getAttribute('aria-pressed'),
    ).toBe('true');
    mocked.getModerationRide.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(cell);
    await waitFor(() => expect(currentHref(router)).toBe(`/admin/rides-moderation/${ID}`));
  });

  it('«Скрытые» — запрос state=hidden, вместо жалоб — время скрытия; вкладка в URL', async () => {
    mocked.listModerationRides.mockResolvedValue({
      items: [
        row({
          id: OTHER,
          status: 'hidden',
          phase: 'hidden',
          openReportCount: 0,
          topReason: null,
          hiddenAt: '2026-10-02T09:30:00.000Z',
        }),
      ],
      nextCursor: null,
    });
    const { router } = await renderApp('/rides-moderation');
    fireEvent.click(await screen.findByRole('button', { name: 'Скрытые' }));
    await waitFor(() =>
      expect(mocked.listModerationRides).toHaveBeenCalledWith({ state: 'hidden', limit: 50 }),
    );
    expect(currentHref(router)).toBe('/admin/rides-moderation?state=hidden');
    const tr = (await screen.findByRole('link', { name: 'Кофе-райд на море' })).closest('tr')!;
    expect(
      within(tr)
        .getAllByRole('cell')
        .map((item) => item.textContent),
    ).toEqual([
      'Кофе-райд на мореМинск',
      '4 октября 2026, 10:00',
      '2 октября 2026, 12:30',
      'Скрыт',
    ]);
    expect(screen.getByRole('columnheader', { name: 'Скрыт' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Жалобы' })).toBeNull();
  });

  it('пустые состояния вкладок', async () => {
    mocked.listModerationRides.mockResolvedValue({ items: [], nextCursor: null });
    await renderApp('/rides-moderation');
    expect(await screen.findByText('Открытых жалоб нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Скрытые' }));
    expect(await screen.findByText('Скрытых райдов нет')).toBeTruthy();
  });

  it('загрузка — скелетон таблицы; ошибка — с повтором', async () => {
    mocked.listModerationRides.mockReturnValue(new Promise(() => undefined));
    await renderApp('/rides-moderation');
    expect((await screen.findAllByTestId('skeleton-row')).length).toBeGreaterThan(0);
    cleanup();

    mocked.listModerationRides.mockRejectedValue(httpError(500, 'INTERNAL'));
    await renderApp('/rides-moderation');
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('organizer — «Нет доступа к разделу», без запроса', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/rides-moderation');
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
    expect(mocked.listModerationRides).not.toHaveBeenCalled();
  });
});
