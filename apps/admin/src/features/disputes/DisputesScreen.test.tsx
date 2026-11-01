// @vitest-environment jsdom
import type { PanelDisputeListItem } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, networkError, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listDisputes: vi.fn(),
    getDispute: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a9001';
const OTHER = '01890a5d-ac96-774b-bcce-b302099a9002';
const RACE_ID = '01890a5d-ac96-774b-bcce-b302099a8080';
const TARGET = '01890a5d-ac96-774b-bcce-b302099a0a01';
const COMPLAINANT = '01890a5d-ac96-774b-bcce-b302099a0b02';

const item = (overrides: Partial<PanelDisputeListItem> = {}): PanelDisputeListItem => ({
  id: ID,
  race: { id: RACE_ID, title: 'Осенний коридор Заславль' },
  status: 'open',
  category: 'vehicle_assistance',
  targetEntryId: TARGET,
  targetRiderName: null,
  complainantEntryId: COMPLAINANT,
  complainantRiderName: null,
  filedAt: '2026-10-26T07:00:00.000Z',
  decidableAt: '2026-10-26T19:00:00.000Z',
  responded: false,
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.listDisputes.mockResolvedValue({ items: [item()], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const chip = (name: string) => screen.getByRole('button', { name });

describe('«Споры» — список (06, AC13)', () => {
  it('по умолчанию — «На рассмотрении»: гонка, участник ·xxxxxx, категория, подан, решение с, ответ, статус; строка → разбор', async () => {
    const { router } = await renderApp('/disputes');
    expect(await screen.findByRole('heading', { name: 'Споры' })).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Участник ·9a0a01' });
    const cells = within(link.closest('tr')!)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(cells).toEqual([
      'Осенний коридор Заславль',
      'Участник ·9a0a01',
      'Похоже на помощь транспорта',
      '26 октября 2026, 10:00',
      '26 октября 2026, 22:00',
      'Нет',
      'На рассмотрении',
    ]);
    expect(mocked.listDisputes).toHaveBeenCalledWith({ status: 'open', limit: 50 });
    expect(chip('На рассмотрении').getAttribute('aria-pressed')).toBe('true');
    mocked.getDispute.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(link);
    await waitFor(() => expect(currentHref(router)).toBe(`/admin/disputes/${ID}`));
  });

  it('цель с именем и согласием — «Анна К. ·xxxxxx» (Q2 profile.md)', async () => {
    mocked.listDisputes.mockResolvedValue({
      items: [item({ targetRiderName: 'Анна К.', complainantRiderName: 'Борис' })],
      nextCursor: null,
    });
    await renderApp('/disputes');
    expect(await screen.findByRole('link', { name: 'Анна К. ·9a0a01' })).toBeTruthy();
    expect(screen.queryByText('Участник ·9a0a01')).toBeNull();
  });

  it('фильтр статуса — в URL и в запросе; «Все» — без статуса', async () => {
    const { router } = await renderApp('/disputes');
    await screen.findByRole('link', { name: 'Участник ·9a0a01' });
    mocked.listDisputes.mockResolvedValue({
      items: [item({ status: 'upheld', responded: true })],
      nextCursor: null,
    });
    fireEvent.click(chip('Удовлетворён'));
    await waitFor(() => expect(currentHref(router)).toBe('/admin/disputes?status=upheld'));
    await waitFor(() =>
      expect(mocked.listDisputes).toHaveBeenLastCalledWith({ status: 'upheld', limit: 50 }),
    );
    expect(await screen.findByText('Есть')).toBeTruthy();
    fireEvent.click(chip('Все'));
    await waitFor(() => expect(mocked.listDisputes).toHaveBeenLastCalledWith({ limit: 50 }));
    expect(currentHref(router)).toBe('/admin/disputes?status=all');
  });

  it('?raceId= — фильтр гонки в запросе, название гонки и «Все гонки»', async () => {
    const { router } = await renderApp(`/disputes?raceId=${RACE_ID}`);
    expect(await screen.findByText('Гонка: Осенний коридор Заславль')).toBeTruthy();
    expect(mocked.listDisputes).toHaveBeenCalledWith({
      status: 'open',
      raceId: RACE_ID,
      limit: 50,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Все гонки' }));
    await waitFor(() => expect(currentHref(router)).toBe('/admin/disputes'));
    await waitFor(() =>
      expect(mocked.listDisputes).toHaveBeenLastCalledWith({ status: 'open', limit: 50 }),
    );
  });

  it('курсор: «Показать ещё» запрашивает следующую страницу', async () => {
    mocked.listDisputes
      .mockResolvedValueOnce({ items: [item()], nextCursor: ID })
      .mockResolvedValueOnce({
        items: [item({ id: OTHER, targetEntryId: OTHER })],
        nextCursor: null,
      });
    await renderApp('/disputes');
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByRole('link', { name: 'Участник ·9a9002' })).toBeTruthy();
    expect(mocked.listDisputes).toHaveBeenLastCalledWith({ status: 'open', limit: 50, cursor: ID });
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('пусто — «Споров нет»', async () => {
    mocked.listDisputes.mockResolvedValue({ items: [], nextCursor: null });
    await renderApp('/disputes');
    expect(await screen.findByText('Споров нет')).toBeTruthy();
  });

  it('загрузка — скелетон при видимом заголовке и фильтрах', async () => {
    mocked.listDisputes.mockReturnValue(new Promise(() => undefined));
    await renderApp('/disputes');
    expect(await screen.findByRole('heading', { name: 'Споры' })).toBeTruthy();
    expect(chip('На рассмотрении')).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('нет сети — «Нет соединения» с повтором; ошибка сервера — «Не удалось загрузить»', async () => {
    mocked.listDisputes.mockRejectedValueOnce(networkError());
    await renderApp('/disputes');
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('link', { name: 'Участник ·9a0a01' })).toBeTruthy();
    cleanup();
    mocked.listDisputes.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp('/disputes');
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });

  it('пункт навигации «Споры» — у модератора есть, у организатора скрыт; прямой URL — «Нет доступа»', async () => {
    await renderApp('/disputes');
    expect(await screen.findByRole('link', { name: 'Споры' })).toBeTruthy();
    cleanup();
    mocked.listDisputes.mockClear();
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/disputes');
    expect(await screen.findByText('Нет доступа к разделу')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Споры' })).toBeNull();
    expect(mocked.listDisputes).not.toHaveBeenCalled();
  });
});
