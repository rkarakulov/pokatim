// @vitest-environment jsdom
import type { RiderProfileModerationRow } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { currentHref, httpError, ME, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    overview: vi.fn(),
    listRiderProfiles: vi.fn(),
    getRiderProfile: vi.fn(),
    riderAvatarUrl: vi.fn((id: string) => `/v1/avatars/${id}`),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const OTHER = '01890a5d-ac96-774b-bcce-b302099a8091';

const row = (overrides: Partial<RiderProfileModerationRow> = {}): RiderProfileModerationRow => ({
  userId: ID,
  name: 'Анна К.',
  openReportCount: 3,
  topReason: 'photo',
  lastReportAt: '2026-10-01T10:00:00.000Z',
  hasAvatar: true,
  hasClub: true,
  openReasons: ['photo'],
  ...overrides,
});

const cellsOf = (link: HTMLElement) =>
  within(link.closest('tr')!)
    .getAllByRole('cell')
    .map((item) => item.textContent);

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
  mocked.overview.mockReturnValue(new Promise(() => undefined));
  mocked.listRiderProfiles.mockResolvedValue({ items: [row()], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Профили райдеров» — очередь жалоб (profile-moderation, AC10)', () => {
  it('подпись (имя при согласии), жалобы с главной причиной, последняя, что есть в профиле; строка → карточка', async () => {
    const { router } = await renderApp('/rider-profiles');
    expect(await screen.findByRole('heading', { name: 'Профили райдеров' })).toBeTruthy();
    const link = await screen.findByRole('link', { name: 'Анна К. ·9a8090' });
    expect(cellsOf(link)).toEqual([
      'Анна К. ·9a8090',
      '3 · Неприемлемое фото',
      '1 октября 2026, 13:00',
      'Фото, клуб',
    ]);
    expect(mocked.listRiderProfiles).toHaveBeenCalledWith({ limit: 50 });
    mocked.getRiderProfile.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(link);
    await waitFor(() => expect(currentHref(router)).toBe(`/admin/rider-profiles/${ID}`));
  });

  it('без согласия — «Участник ·<id>»; ни фото, ни клуба — «—»', async () => {
    mocked.listRiderProfiles.mockResolvedValue({
      items: [row({ name: null, hasAvatar: false, hasClub: false, topReason: 'impersonation' })],
      nextCursor: null,
    });
    await renderApp('/rider-profiles');
    const link = await screen.findByRole('link', { name: 'Участник ·9a8090' });
    expect(cellsOf(link)).toEqual([
      'Участник ·9a8090',
      '3 · Выдаёт себя за другого',
      '1 октября 2026, 13:00',
      '—',
    ]);
  });

  it('«Показать ещё» — следующая страница по курсору сервера', async () => {
    mocked.listRiderProfiles
      .mockResolvedValueOnce({ items: [row()], nextCursor: 'next-1' })
      .mockResolvedValueOnce({
        items: [row({ userId: OTHER, name: 'Борис', hasClub: false })],
        nextCursor: null,
      });
    await renderApp('/rider-profiles');
    await screen.findByRole('link', { name: 'Анна К. ·9a8090' });
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByRole('link', { name: 'Борис ·9a8091' })).toBeTruthy();
    expect(mocked.listRiderProfiles).toHaveBeenLastCalledWith({ limit: 50, cursor: 'next-1' });
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('пусто — «Жалоб нет»', async () => {
    mocked.listRiderProfiles.mockResolvedValue({ items: [], nextCursor: null });
    await renderApp('/rider-profiles');
    expect(await screen.findByText('Жалоб нет')).toBeTruthy();
  });

  it('несколько причин открытых жалоб — строкой под главной (порядок справочника)', async () => {
    mocked.listRiderProfiles.mockResolvedValue({
      items: [row({ openReasons: ['photo', 'name', 'spam'] })],
      nextCursor: null,
    });
    await renderApp('/rider-profiles');
    const link = await screen.findByRole('link', { name: 'Анна К. ·9a8090' });
    expect(cellsOf(link)[1]).toBe(
      '3 · Неприемлемое фотоПричины: Неприемлемое фото, Неприемлемое имя, Спам или реклама',
    );
  });

  it('вкладки «Все / Имя / Фото / Клуб» — фильтр в URL и в запросе; пусто — текст вкладки', async () => {
    const { router } = await renderApp('/rider-profiles');
    await screen.findByRole('link', { name: 'Анна К. ·9a8090' });
    const tabs = screen.getByRole('group', { name: 'Причина жалобы' });
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Все', 'Имя', 'Фото', 'Клуб']);
    expect(within(tabs).getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    mocked.listRiderProfiles.mockResolvedValue({ items: [], nextCursor: null });
    fireEvent.click(within(tabs).getByRole('button', { name: 'Имя' }));
    await waitFor(() => expect(currentHref(router)).toBe('/admin/rider-profiles?reason=name'));
    expect(await screen.findByText('Жалоб на имя нет')).toBeTruthy();
    expect(mocked.listRiderProfiles).toHaveBeenLastCalledWith({ reason: 'name', limit: 50 });
    expect(screen.getByRole('button', { name: 'Имя' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Фото' }));
    expect(await screen.findByText('Жалоб на фото нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Клуб' }));
    expect(await screen.findByText('Жалоб на клуб нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    await waitFor(() => expect(currentHref(router)).toBe('/admin/rider-profiles'));
    expect(await screen.findByText('Жалоб нет')).toBeTruthy();
  });

  it('прямой адрес ?reason=photo — вкладка «Фото»; «Показать ещё» сохраняет фильтр', async () => {
    mocked.listRiderProfiles
      .mockResolvedValueOnce({ items: [row()], nextCursor: 'next-1' })
      .mockResolvedValueOnce({ items: [row({ userId: OTHER, name: 'Борис' })], nextCursor: null });
    await renderApp('/rider-profiles?reason=photo');
    await screen.findByRole('link', { name: 'Анна К. ·9a8090' });
    expect(screen.getByRole('button', { name: 'Фото' }).getAttribute('aria-pressed')).toBe('true');
    expect(mocked.listRiderProfiles).toHaveBeenCalledWith({ reason: 'photo', limit: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByRole('link', { name: 'Борис ·9a8091' })).toBeTruthy();
    expect(mocked.listRiderProfiles).toHaveBeenLastCalledWith({
      reason: 'photo',
      limit: 50,
      cursor: 'next-1',
    });
  });

  it('причина вне вкладок (?reason=spam) — «Все», без фильтра', async () => {
    await renderApp('/rider-profiles?reason=spam');
    await screen.findByRole('link', { name: 'Анна К. ·9a8090' });
    expect(screen.getByRole('button', { name: 'Все' }).getAttribute('aria-pressed')).toBe('true');
    expect(mocked.listRiderProfiles).toHaveBeenCalledWith({ limit: 50 });
  });

  it('загрузка — скелетон таблицы; ошибка — с повтором', async () => {
    mocked.listRiderProfiles.mockReturnValue(new Promise(() => undefined));
    await renderApp('/rider-profiles');
    expect((await screen.findAllByTestId('skeleton-row')).length).toBeGreaterThan(0);
    cleanup();

    mocked.listRiderProfiles.mockRejectedValue(httpError(500, 'INTERNAL'));
    await renderApp('/rider-profiles');
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('organizer — «Нет доступа к разделу», без запроса', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/rider-profiles');
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
    expect(mocked.listRiderProfiles).not.toHaveBeenCalled();
  });
});
