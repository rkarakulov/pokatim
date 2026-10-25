// @vitest-environment jsdom
import type { PanelMember, PanelMemberList } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp, USER_ID } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    health: vi.fn(),
    resendVerification: vi.fn(),
    listMembers: vi.fn(),
    grantRole: vi.fn(),
    changeRole: vi.fn(),
    revokeRole: vi.fn(),
    listAudit: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const MARIA = '01890a5d-ac96-774b-bcce-b302099a8058';
const IVAN = '01890a5d-ac96-774b-bcce-b302099a8059';

const member = (overrides: Partial<PanelMember>): PanelMember => ({
  userId: MARIA,
  displayName: 'Мария',
  email: 'maria@example.by',
  role: 'moderator',
  status: 'active',
  grantedAt: '2026-10-25T10:00:00.000Z',
  revokedAt: null,
  ...overrides,
});

const LIST: PanelMemberList = {
  items: [
    member({ userId: USER_ID, displayName: 'Ольга', email: 'olga@example.by', role: 'admin' }),
    member({}),
    member({
      userId: IVAN,
      displayName: 'Иван',
      email: 'ivan@example.by',
      role: 'organizer',
      status: 'revoked',
      grantedAt: '2026-10-20T21:30:00.000Z',
      revokedAt: '2026-10-24T09:00:00.000Z',
    }),
  ],
  truncated: false,
};

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.listMembers.mockResolvedValue(LIST);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const rowOf = (name: string) =>
  screen.getByRole('cell', { name: new RegExp(`^${name}`) }).closest('tr')!;

describe('«Сотрудники» (AC11)', () => {
  it('загрузка — скелетон строк под видимыми заголовком, шапкой и фильтрами', async () => {
    mocked.listMembers.mockReturnValue(new Promise(() => undefined));
    await renderApp('/members');
    expect(await screen.findByRole('heading', { name: 'Сотрудники' })).toBeTruthy();
    expect(screen.getByLabelText('Статус')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'E-mail' })).toBeTruthy();
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(8);
  });

  it('таблица: имя, e-mail, роль, статус, выдана (Минск); своя строка без действий', async () => {
    await renderApp('/members');
    await screen.findByText('maria@example.by');

    const ivan = within(rowOf('Иван'));
    expect(ivan.getByText('Организатор')).toBeTruthy();
    expect(ivan.getByText('Роль снята')).toBeTruthy();
    expect(ivan.getByText('21.10.2026, 00:30')).toBeTruthy();
    expect(ivan.queryByRole('button')).toBeNull();

    expect(within(rowOf('Ольга')).getByText('Ольга (вы)')).toBeTruthy();
    expect(within(rowOf('Ольга')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Мария')).getByRole('button', { name: 'Снять роль: Мария' })).toBeTruthy();
  });

  it('фильтры статуса и роли, поиск по имени и e-mail', async () => {
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    const rows = () => within(screen.getByRole('table')).getAllByRole('row').length - 1;
    expect(rows()).toBe(3);

    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'revoked' } });
    expect(rows()).toBe(1);
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'admin' } });
    expect(rows()).toBe(1);
    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'IVAN@' } });
    expect(rows()).toBe(1);
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'никого' } });
    expect(screen.getByText('Никого не нашли — измените фильтры.')).toBeTruthy();
  });

  it('«Выдать роль»: 404 — под полем e-mail, окно открыто; успех — запрос по схеме и список перечитан', async () => {
    mocked.grantRole.mockRejectedValueOnce(httpError(404, 'NOT_FOUND'));
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Выдать роль' }));

    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('E-mail пользователя'), {
      target: { value: 'new@example.by' },
    });
    fireEvent.change(dialog.getByLabelText('Имя в панели'), { target: { value: 'Новый' } });
    fireEvent.change(dialog.getByLabelText('Роль'), { target: { value: 'organizer' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Выдать роль' }));

    expect(
      await dialog.findByText(
        'Пользователь с таким e-mail не найден — попросите зарегистрироваться в приложении.',
      ),
    ).toBeTruthy();
    expect(dialog.getByLabelText('E-mail пользователя').getAttribute('aria-invalid')).toBe('true');

    mocked.grantRole.mockResolvedValueOnce(member({ userId: IVAN }));
    fireEvent.click(dialog.getByRole('button', { name: 'Выдать роль' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.grantRole).toHaveBeenLastCalledWith({
      email: 'new@example.by',
      displayName: 'Новый',
      role: 'organizer',
    });
    expect(mocked.listMembers).toHaveBeenCalledTimes(2);
  });

  it('«Выдать роль»: 409 неподтверждённый и уже член — под полем e-mail', async () => {
    mocked.grantRole
      .mockRejectedValueOnce(httpError(409, 'PANEL_USER_UNVERIFIED'))
      .mockRejectedValueOnce(httpError(409, 'PANEL_ALREADY_MEMBER'));
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Выдать роль' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('E-mail пользователя'), {
      target: { value: 'x@example.by' },
    });
    fireEvent.change(dialog.getByLabelText('Имя в панели'), { target: { value: 'Икс' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Выдать роль' }));
    expect(await dialog.findByText(/не подтверждён/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Выдать роль' }));
    expect(await dialog.findByText('Этот пользователь уже в команде платформы.')).toBeTruthy();
  });

  it('«Изменить роль» — новая роль и причина; «Снять роль» — разрушительный вариант, ошибка сервера в окне', async () => {
    mocked.changeRole.mockResolvedValue(member({ role: 'organizer' }));
    mocked.revokeRole.mockRejectedValue(httpError(409, 'PANEL_LAST_ADMIN'));
    await renderApp('/members');
    await screen.findByText('maria@example.by');

    fireEvent.click(screen.getByRole('button', { name: 'Изменить роль: Мария' }));
    let dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'Изменить роль: Мария' })).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Новая роль'), { target: { value: 'organizer' } });
    fireEvent.change(dialog.getByLabelText('Причина (обязательно)'), {
      target: { value: 'смена задач' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Изменить роль' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.changeRole).toHaveBeenCalledWith(MARIA, {
      role: 'organizer',
      reason: 'смена задач',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Снять роль: Мария' }));
    dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByText('Сессии панели сотрудника завершатся. Доступ к приложению сохранится.'),
    ).toBeTruthy();
    const confirm = dialog.getByRole('button', { name: 'Снять роль' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(dialog.getByLabelText('Причина (обязательно)'), {
      target: { value: 'ушла из команды' },
    });
    fireEvent.click(confirm);
    expect(await dialog.findByText('Нельзя оставить панель без администратора.')).toBeTruthy();
    expect(mocked.revokeRole).toHaveBeenCalledWith(MARIA, { reason: 'ушла из команды' });
  });

  it('ошибка без данных — «Нет соединения»/«Не удалось загрузить» с повтором; 403 — «Нет доступа к разделу»', async () => {
    mocked.listMembers.mockRejectedValue(httpError(500, 'INTERNAL'));
    await renderApp('/members');
    expect(await screen.findByText('Не удалось загрузить', {}, { timeout: 4000 })).toBeTruthy();
    cleanup();

    mocked.listMembers.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await renderApp('/members');
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
  });

  it('пусто — пустое состояние', async () => {
    mocked.listMembers.mockResolvedValue({ items: [], truncated: false });
    await renderApp('/members');
    expect(await screen.findByText('Сотрудников пока нет')).toBeTruthy();
  });
});
