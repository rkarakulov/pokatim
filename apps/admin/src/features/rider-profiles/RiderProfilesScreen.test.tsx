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
  ...overrides,
});

const cellsOf = (link: HTMLElement) =>
  within(link.closest('tr')!)
    .getAllByRole('cell')
    .map((item) => item.textContent);

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
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
