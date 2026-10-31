// @vitest-environment jsdom
import type { PanelInvitation, PanelMember, PanelMemberList } from '@pokatim/contracts';
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
    resetMemberTotp: vi.fn(),
    listInvitations: vi.fn(),
    invite: vi.fn(),
    revokeInvitation: vi.fn(),
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
  totpEnabled: false,
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
  mocked.listInvitations.mockResolvedValue({ items: [], truncated: false });
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
    const table = within(screen.getByRole('table', { name: 'Сотрудники' }));
    expect(table.getByRole('columnheader', { name: 'E-mail' })).toBeTruthy();
    expect(table.getAllByTestId('skeleton-row')).toHaveLength(8);
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
    const rows = () =>
      within(screen.getByRole('table', { name: 'Сотрудники' })).getAllByRole('row').length - 1;
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

  it('«Выдать роль»: 404 — под полем e-mail с подсказкой о приглашении, окно открыто; успех — запрос по схеме и список перечитан', async () => {
    mocked.grantRole.mockRejectedValueOnce(httpError(404, 'NOT_FOUND'));
    const { queryClient } = await renderApp('/members');
    // журнал, открытый раньше: после выдачи роли его кэш устарел (staleTime панели — B12)
    queryClient.setQueryData(['admin', 'audit', 'probe'], 'журнал');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Выдать роль' }));

    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('E-mail пользователя'), {
      target: { value: 'new@example.by' },
    });
    fireEvent.change(dialog.getByLabelText('Имя в панели'), { target: { value: 'Новый' } });
    fireEvent.change(dialog.getByLabelText('Роль'), { target: { value: 'organizer' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Выдать роль' }));

    expect(await dialog.findByText('Аккаунта нет — отправьте приглашение.')).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Отправить приглашение' })).toBeTruthy();
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
    expect(queryClient.getQueryState(['admin', 'audit', 'probe'])?.isInvalidated).toBe(true);
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
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
    cleanup();

    mocked.listMembers.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await renderApp('/members');
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
  });

  it('список обрезан сервером — подпись с пределом из контракта', async () => {
    mocked.listMembers.mockResolvedValue({ ...LIST, truncated: true });
    await renderApp('/members');
    expect(await screen.findByText('Показаны первые 500 сотрудников.')).toBeTruthy();
  });

  it('пусто — пустое состояние', async () => {
    mocked.listMembers.mockResolvedValue({ items: [], truncated: false });
    await renderApp('/members');
    expect(await screen.findByText('Сотрудников пока нет')).toBeTruthy();
  });
});

describe('«Сотрудники» — 2FA (ADR-0024, D10)', () => {
  it('снятая роль с подключённой 2FA — только «Сбросить 2FA», без смены и снятия роли (ревью pass 3)', async () => {
    mocked.listMembers.mockResolvedValue({
      items: [
        member({
          userId: IVAN,
          displayName: 'Иван',
          email: 'ivan@example.by',
          status: 'revoked',
          revokedAt: '2026-10-24T09:00:00.000Z',
          totpEnabled: true,
        }),
        member({ status: 'revoked', revokedAt: '2026-10-24T09:00:00.000Z' }),
      ],
      truncated: false,
    });
    await renderApp('/members');
    await screen.findByText('ivan@example.by');
    const ivan = within(rowOf('Иван'));
    expect(ivan.getByRole('button', { name: 'Сбросить 2FA: Иван' })).toBeTruthy();
    expect(ivan.queryByRole('button', { name: /Изменить/ })).toBeNull();
    expect(ivan.queryByRole('button', { name: /Снять/ })).toBeNull();
    expect(within(rowOf('Мария')).queryByRole('button')).toBeNull();
  });

  it('колонка «2FA»; «Сбросить 2FA» — только у подключённой и не у себя; причина обязательна, ошибка — в окне', async () => {
    mocked.listMembers.mockResolvedValue({
      items: [
        member({
          userId: USER_ID,
          displayName: 'Ольга',
          email: 'olga@example.by',
          role: 'admin',
          totpEnabled: true,
        }),
        member({ totpEnabled: true }),
        member({ userId: IVAN, displayName: 'Иван', email: 'ivan@example.by' }),
      ],
      truncated: false,
    });
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    expect(screen.getByRole('columnheader', { name: '2FA' })).toBeTruthy();
    expect(within(rowOf('Мария')).getByText('Подключена')).toBeTruthy();
    expect(within(rowOf('Иван')).getByText('Нет')).toBeTruthy();
    expect(within(rowOf('Ольга')).queryByRole('button')).toBeNull();
    expect(within(rowOf('Иван')).queryByRole('button', { name: /Сбросить 2FA/ })).toBeNull();

    mocked.resetMemberTotp.mockRejectedValueOnce(httpError(409, 'TOTP_NOT_ENABLED'));
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить 2FA: Мария' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'Сбросить 2FA: Мария' })).toBeTruthy();
    const confirm = dialog.getByRole('button', { name: 'Сбросить 2FA' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(dialog.getByLabelText('Причина (обязательно)'), {
      target: { value: 'потерян телефон' },
    });
    fireEvent.click(confirm);
    expect(await dialog.findByText('У сотрудника 2FA уже не подключена.')).toBeTruthy();

    mocked.resetMemberTotp.mockResolvedValueOnce(undefined);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.resetMemberTotp).toHaveBeenLastCalledWith(MARIA, { reason: 'потерян телефон' });
  });
});

const invitation = (overrides: Partial<PanelInvitation>): PanelInvitation => ({
  id: '01890a5d-ac96-774b-bcce-b30209900001',
  email: 'new@example.by',
  displayName: 'Новый',
  role: 'organizer',
  invitedBy: 'Ольга',
  createdAt: '2026-10-30T10:00:00.000Z',
  expiresAt: '2026-11-06T10:00:00.000Z',
  expired: false,
  emailState: 'sent',
  ...overrides,
});

describe('«Сотрудники» — приглашения (ADR-0026)', () => {
  const invitations = () => within(screen.getByRole('region', { name: 'Приглашения' }));

  it('«Пригласить» — только с members.manage; окно: e-mail, имя, роль → «Отправить приглашение», список перечитан', async () => {
    mocked.invite.mockResolvedValueOnce(invitation({}));
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('heading', { name: 'Пригласить в команду' })).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('E-mail'), { target: { value: 'new@example.by' } });
    fireEvent.change(dialog.getByLabelText('Имя в панели'), { target: { value: 'Новый' } });
    fireEvent.change(dialog.getByLabelText('Роль'), { target: { value: 'organizer' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Отправить приглашение' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.invite).toHaveBeenCalledWith({
      email: 'new@example.by',
      displayName: 'Новый',
      role: 'organizer',
    });
    expect(mocked.grantRole).not.toHaveBeenCalled();
    expect(mocked.listInvitations).toHaveBeenCalledTimes(2);
  });

  it('moderator с members.read — блок виден, «Пригласить» и действия — нет', async () => {
    mocked.me.mockResolvedValue({ ...ME.admin, permissions: ['members.read', 'audit.read'] });
    mocked.listInvitations.mockResolvedValue({ items: [invitation({})], truncated: false });
    await renderApp('/members');
    expect(await invitations().findByText('new@example.by')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Пригласить' })).toBeNull();
    expect(invitations().queryByRole('button', { name: /Отправить повторно|Отозвать/ })).toBeNull();
  });

  it('NOT_FOUND в «Выдать роль» → «Отправить приглашение» с тем же e-mail', async () => {
    mocked.grantRole.mockRejectedValueOnce(httpError(404, 'NOT_FOUND'));
    mocked.invite.mockResolvedValueOnce(invitation({}));
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Выдать роль' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('E-mail пользователя'), {
      target: { value: 'new@example.by' },
    });
    fireEvent.change(dialog.getByLabelText('Имя в панели'), { target: { value: 'Новый' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Выдать роль' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Отправить приглашение' }));

    expect(dialog.getByRole('heading', { name: 'Пригласить в команду' })).toBeTruthy();
    expect((dialog.getByLabelText('E-mail') as HTMLInputElement).value).toBe('new@example.by');
    fireEvent.click(dialog.getByRole('button', { name: 'Отправить приглашение' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.invite).toHaveBeenCalledWith({
      email: 'new@example.by',
      displayName: 'Новый',
      role: 'moderator',
    });
  });

  it('блок: строки с «Истекло» и «Письмо не отправлено»; «Отправить повторно» — тот же POST; «Отозвать» — подтверждение', async () => {
    const failed = invitation({ emailState: 'failed' });
    const expired = invitation({
      id: '01890a5d-ac96-774b-bcce-b30209900002',
      email: 'old@example.by',
      expired: true,
      createdAt: '2026-10-20T10:00:00.000Z',
    });
    mocked.listInvitations.mockResolvedValue({ items: [failed, expired], truncated: false });
    mocked.invite.mockResolvedValueOnce(invitation({ id: '01890a5d-ac96-774b-bcce-b30209900003' }));
    mocked.revokeInvitation.mockResolvedValueOnce(undefined);
    await renderApp('/members');
    await invitations().findByText('new@example.by');

    const row = (email: string) => within(invitations().getByText(email).closest('tr')!);
    expect(row('new@example.by').getByText('Письмо не отправлено')).toBeTruthy();
    expect(row('new@example.by').getByText('06.11.2026, 13:00')).toBeTruthy();
    expect(row('old@example.by').getByText('Истекло')).toBeTruthy();
    expect(row('new@example.by').getByText('Ольга')).toBeTruthy();

    fireEvent.click(
      invitations().getByRole('button', { name: 'Отправить повторно: new@example.by' }),
    );
    expect(
      await invitations().findByText('Приглашение отправлено повторно: new@example.by'),
    ).toBeTruthy();
    expect(mocked.invite).toHaveBeenCalledWith({
      email: 'new@example.by',
      displayName: 'Новый',
      role: 'organizer',
    });

    fireEvent.click(invitations().getByRole('button', { name: 'Отозвать: old@example.by' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Ссылка из письма перестанет работать.')).toBeTruthy();
    expect(dialog.queryByLabelText(/Причина/)).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Отозвать' }));
    await waitFor(() =>
      expect(mocked.revokeInvitation).toHaveBeenCalledWith('01890a5d-ac96-774b-bcce-b30209900002'),
    );
  });

  it('скелетон, ошибка с повтором, пусто — «Приглашений нет»', async () => {
    mocked.listInvitations.mockReturnValue(new Promise(() => undefined));
    await renderApp('/members');
    expect(await invitations().findAllByTestId('skeleton-row')).toHaveLength(8);
    cleanup();

    mocked.listInvitations.mockRejectedValue(httpError(500, 'INTERNAL'));
    await renderApp('/members');
    expect(await invitations().findByText('Не удалось загрузить')).toBeTruthy();
    expect(invitations().getByRole('button', { name: 'Повторить' })).toBeTruthy();
    cleanup();

    mocked.listInvitations.mockResolvedValue({ items: [], truncated: false });
    await renderApp('/members');
    expect(await invitations().findByText('Приглашений нет')).toBeTruthy();
  });

  it('ошибка приглашения: уже в команде — под полем e-mail; 503 — в окне', async () => {
    mocked.invite
      .mockRejectedValueOnce(httpError(409, 'PANEL_ALREADY_MEMBER'))
      .mockRejectedValueOnce(httpError(503, 'PANEL_INVITATIONS_UNAVAILABLE'));
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('E-mail'), { target: { value: 'maria@example.by' } });
    fireEvent.change(dialog.getByLabelText('Имя в панели'), { target: { value: 'М' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Отправить приглашение' }));
    expect(await dialog.findByText('Этот пользователь уже в команде платформы.')).toBeTruthy();
    expect(dialog.getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(dialog.getByRole('button', { name: 'Отправить приглашение' }));
    expect(await dialog.findByRole('alert')).toBeTruthy();
    expect(dialog.getByText(/Приглашения временно недоступны/)).toBeTruthy();
  });

  it('«Отозвать»: окно открыто до ответа, подтверждение busy, действия строки заблокированы; 404 — свой текст в окне', async () => {
    mocked.listInvitations.mockResolvedValue({ items: [invitation({})], truncated: false });
    let finish!: (value: undefined) => void;
    mocked.revokeInvitation.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await renderApp('/members');
    await invitations().findByText('new@example.by');

    fireEvent.click(invitations().getByRole('button', { name: 'Отозвать: new@example.by' }));
    const dialog = within(screen.getByRole('dialog'));
    const confirm = dialog.getByRole('button', { name: 'Отозвать' });
    fireEvent.click(confirm);

    await waitFor(() => expect(confirm.getAttribute('aria-busy')).toBe('true'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(confirm);
    expect(mocked.revokeInvitation).toHaveBeenCalledTimes(1);
    expect(
      invitations().getByRole('button', { name: 'Отправить повторно: new@example.by' }),
    ).toHaveProperty('disabled', true);
    expect(invitations().getByRole('button', { name: 'Отозвать: new@example.by' })).toHaveProperty(
      'disabled',
      true,
    );

    finish(undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // повтор на уже закрытое приглашение — 404: текст про приглашение, не про аккаунт
    mocked.revokeInvitation.mockRejectedValueOnce(httpError(404, 'NOT_FOUND'));
    fireEvent.click(invitations().getByRole('button', { name: 'Отозвать: new@example.by' }));
    const again = within(screen.getByRole('dialog'));
    fireEvent.click(again.getByRole('button', { name: 'Отозвать' }));
    expect(await again.findByText('Приглашение уже принято или отозвано.')).toBeTruthy();
    expect(screen.queryByText('Аккаунта нет — отправьте приглашение.')).toBeNull();
  });

  it('NOT_FOUND вне «Выдать роль» (смена роли) — прежний нейтральный текст, без совета пригласить', async () => {
    mocked.changeRole.mockRejectedValueOnce(httpError(404, 'NOT_FOUND'));
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить роль: Мария' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Причина (обязательно)'), {
      target: { value: 'смена задач' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Изменить роль' }));
    expect(
      await dialog.findByText(
        'Пользователь с таким e-mail не найден — попросите зарегистрироваться в приложении.',
      ),
    ).toBeTruthy();
  });

  it('окно приглашения: срок ссылки — из контракта', async () => {
    await renderApp('/members');
    await screen.findByText('maria@example.by');
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить' }));
    expect(within(screen.getByRole('dialog')).getByText(/Ссылка действует 7 дней/)).toBeTruthy();
  });
});
