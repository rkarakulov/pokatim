// @vitest-environment jsdom
import type { AuditEntry } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { ME, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    health: vi.fn(),
    resendVerification: vi.fn(),
    listMembers: vi.fn(),
    listAudit: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const MARIA = '01890a5d-ac96-774b-bcce-b302099a8058';
const id = (n: number) => `01890a5d-ac96-774b-bcce-${String(n).padStart(12, '0')}`;

const revoked: AuditEntry = {
  id: id(3),
  at: '2026-10-25T21:15:00.000Z',
  action: 'panel.role_changed',
  actor: { kind: 'user', userId: USER_ID, displayName: 'Ольга' },
  target: { userId: MARIA, displayName: 'Мария' },
  reason: 'смена задач',
  details: { roleFrom: 'moderator', roleTo: 'organizer' },
};
const granted: AuditEntry = {
  id: id(2),
  at: '2026-10-25T09:00:00.000Z',
  action: 'panel.role_granted',
  actor: { kind: 'cli' },
  target: { userId: USER_ID, displayName: 'Ольга' },
  reason: null,
  details: { roleTo: 'admin' },
};
const signedIn: AuditEntry = {
  id: id(1),
  at: '2026-10-24T08:00:00.000Z',
  action: 'panel.signed_in',
  actor: { kind: 'user', userId: USER_ID, displayName: 'Ольга' },
  target: null,
  reason: null,
  details: null,
};

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.moderator);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Журнал действий» (AC12)', () => {
  it('таблица: время по Минску, кто, действие словами, над кем, причина', async () => {
    mocked.listAudit.mockResolvedValue({ items: [revoked, granted], nextCursor: null });
    await renderApp('/audit');
    await screen.findByText('смена задач');

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      [
        '26.10.2026, 00:15',
        'Ольга',
        'Изменена роль: Модератор → Организатор',
        'Мария',
        'смена задач',
      ],
      ['25.10.2026, 12:00', 'Сервер (CLI)', 'Выдана роль: Администратор', 'Ольга', '—'],
    ]);
    expect(screen.getByText('Время — Europe/Minsk')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('«Показать ещё» — следующая страница по курсору сервера', async () => {
    mocked.listAudit
      .mockResolvedValueOnce({ items: [revoked, granted], nextCursor: granted.id })
      .mockResolvedValueOnce({ items: [signedIn], nextCursor: null });
    await renderApp('/audit');
    await screen.findByText('смена задач');

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));

    expect(await screen.findByText('Вход в панель')).toBeTruthy();
    expect(mocked.listAudit).toHaveBeenLastCalledWith({ limit: 50, cursor: granted.id });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull());
  });

  it('фильтр действия — запрос с action', async () => {
    mocked.listAudit.mockResolvedValue({ items: [granted], nextCursor: null });
    await renderApp('/audit');
    await screen.findByText('Сервер (CLI)');

    fireEvent.change(screen.getByLabelText('Действие'), {
      target: { value: 'panel.role_granted' },
    });

    await waitFor(() =>
      expect(mocked.listAudit).toHaveBeenLastCalledWith({
        limit: 50,
        action: 'panel.role_granted',
      }),
    );
  });

  it('пусто — «Записей пока нет»', async () => {
    mocked.listAudit.mockResolvedValue({ items: [], nextCursor: null });
    await renderApp('/audit');
    expect(await screen.findByText('Записей пока нет')).toBeTruthy();
  });
});
