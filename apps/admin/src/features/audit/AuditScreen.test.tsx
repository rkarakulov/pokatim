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
  subject: null,
  details: { roleFrom: 'moderator', roleTo: 'organizer' },
};
const granted: AuditEntry = {
  id: id(2),
  at: '2026-10-25T09:00:00.000Z',
  action: 'panel.role_granted',
  actor: { kind: 'cli' },
  target: { userId: USER_ID, displayName: 'Ольга' },
  reason: null,
  subject: null,
  details: { roleTo: 'admin' },
};
const signedIn: AuditEntry = {
  id: id(1),
  at: '2026-10-24T08:00:00.000Z',
  action: 'panel.signed_in',
  actor: { kind: 'user', userId: USER_ID, displayName: 'Ольга' },
  target: null,
  reason: null,
  subject: null,
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
  it('таблица: время по Минску, кто, действие словами, объект, над кем, причина', async () => {
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
        '—',
        'Мария',
        'смена задач',
      ],
      ['25.10.2026, 12:00', 'Сервер (CLI)', 'Выдана роль: Администратор', '—', 'Ольга', '—'],
    ]);
    expect(screen.getByText('Время — Europe/Minsk')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('admin-02: объект действия (снимок названия), причина отмены шаблоном, изменённые поля', async () => {
    mocked.listAudit.mockResolvedValue({
      items: [
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8061',
          action: 'race.cancelled',
          subject: { kind: 'race', id: signedIn.id, label: 'Минское кольцо' },
          details: { cancelReason: 'weather' },
        },
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8062',
          action: 'season.updated',
          subject: { kind: 'season', id: signedIn.id, label: 'Сезон 2026' },
          details: { changedFields: ['name', 'endsOn', 'futureField'] },
        },
      ],
      nextCursor: null,
    });
    await renderApp('/audit');
    expect(await screen.findByText('Минское кольцо')).toBeTruthy();
    expect(screen.getByText('Отменена гонка: Неблагоприятные погодные условия')).toBeTruthy();
    // подписи полей по виду объекта; незнакомое (сервер новее) — нейтральная подпись
    expect(screen.getByText('Изменён сезон: Название, Конец, другое поле')).toBeTruthy();
    expect(screen.getByText('Сезон 2026')).toBeTruthy();
  });

  it('05b: модерация райдов — действие словами, объект-райд, число закрытых жалоб', async () => {
    mocked.listAudit.mockResolvedValue({
      items: [
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8063',
          action: 'ride.hidden',
          reason: 'Оскорбления',
          subject: { kind: 'ride', id: signedIn.id, label: 'Кофе-райд на море' },
          details: { reportCount: 2 },
        },
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8064',
          action: 'ride.restored',
          reason: 'Ошибка',
          subject: { kind: 'ride', id: signedIn.id, label: 'Кофе-райд на море' },
        },
      ],
      nextCursor: null,
    });
    await renderApp('/audit');
    expect(await screen.findByText('Скрыт кофе-райд: Жалоб: 2')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Возвращён кофе-райд' })).toBeTruthy();
    expect(screen.getAllByText('Кофе-райд на море')).toHaveLength(2);
  });

  it('profile-moderation-followups: сброс фото, включивший запрет, — дата окончания запрета; снятие запрета', async () => {
    mocked.listAudit.mockResolvedValue({
      items: [
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8065',
          action: 'profile.avatar_reset',
          reason: 'Фото с рекламой',
          subject: null,
          details: { reportCount: 2, avatarBlockedUntil: '2026-11-29T11:05:00.000Z' },
        },
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8066',
          action: 'profile.avatar_reset',
          reason: 'Фото с рекламой',
          subject: null,
          details: { reportCount: 1 },
        },
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8067',
          action: 'profile.avatar_unblocked',
          reason: 'Райдер обжаловал',
          subject: null,
        },
      ],
      nextCursor: null,
    });
    await renderApp('/audit');
    expect(
      await screen.findByText(
        'Сброшено фото участника: Жалоб: 2 · запрет загрузки фото до 29 ноября 2026, 14:05',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Сброшено фото участника: Жалоб: 1')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Снят запрет загрузки фото' })).toBeTruthy();
  });

  it('routes-06: решение по заявке — причина отклонения справочником, поправленные поля подписями', async () => {
    mocked.listAudit.mockResolvedValue({
      items: [
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8065',
          action: 'route.submission_rejected',
          reason: 'Уберите адрес из названия',
          subject: { kind: 'route', id: signedIn.id, label: 'Вокруг моря' },
          details: { rejectionReason: 'bad_title' },
        },
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8066',
          action: 'route.submission_approved',
          subject: { kind: 'route', id: signedIn.id, label: 'Вокруг моря' },
          details: { changedFields: ['city', 'surfaces'] },
        },
      ],
      nextCursor: null,
    });
    await renderApp('/audit');
    expect(
      await screen.findByText('Маршрут райдера отклонён: причина — Неподходящее название'),
    ).toBeTruthy();
    expect(screen.getByText('Уберите адрес из названия')).toBeTruthy();
    expect(screen.getByText('Маршрут райдера одобрен: Город старта, Покрытие')).toBeTruthy();
  });

  it('app-themes: смена темы приложения — «Классика → Атлас», объект «Оформление приложения»', async () => {
    mocked.listAudit.mockResolvedValue({
      items: [
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8065',
          action: 'appearance.theme_changed',
          subject: {
            kind: 'platform',
            id: '00000000-0000-0000-0000-000000000000',
            label: 'Оформление приложения',
          },
          details: { themeFrom: 'classic', themeTo: 'atlas' },
        },
      ],
      nextCursor: null,
    });
    await renderApp('/audit');
    expect(await screen.findByText('Тема приложения изменена: Классика → Атлас')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Оформление приложения' })).toBeTruthy();
  });

  it('halloween-decor: включение декора — «Без декора → Хеллоуин»', async () => {
    mocked.listAudit.mockResolvedValue({
      items: [
        {
          ...signedIn,
          id: '01890a5d-ac96-774b-bcce-b302099a8066',
          action: 'appearance.decor_changed',
          subject: {
            kind: 'platform',
            id: '00000000-0000-0000-0000-000000000000',
            label: 'Оформление приложения',
          },
          details: { decorFrom: 'none', decorTo: 'halloween' },
        },
      ],
      nextCursor: null,
    });
    await renderApp('/audit');
    expect(await screen.findByText('Сезонный декор изменён: Без декора → Хеллоуин')).toBeTruthy();
  });

  it('event-tickets: отметка — код билета; материалы — подписи действий и полей', async () => {
    const race = { kind: 'race' as const, id: signedIn.id, label: 'Минское кольцо' };
    mocked.listAudit.mockResolvedValue({
      items: [
        {
          ...signedIn,
          id: id(71),
          action: 'tickets.checked_in',
          subject: race,
          details: { ticketCode: '7XK2M9PQRT' },
        },
        { ...signedIn, id: id(72), action: 'tickets.material_added', subject: race, details: null },
        {
          ...signedIn,
          id: id(73),
          action: 'tickets.material_updated',
          subject: race,
          details: { changedFields: ['title', 'url'] },
        },
        {
          ...signedIn,
          id: id(74),
          action: 'tickets.material_removed',
          subject: race,
          details: null,
        },
        {
          ...signedIn,
          id: id(75),
          action: 'tickets.materials_reordered',
          subject: race,
          details: null,
        },
        {
          ...signedIn,
          id: id(76),
          action: 'tickets.settings_updated',
          subject: race,
          details: { changedFields: ['enabled', 'startsAt'] },
        },
      ],
      nextCursor: null,
    });
    await renderApp('/audit');
    expect(await screen.findByText('Участник отмечен: Билет ·7XK2M-9PQRT')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Добавлен материал события' })).toBeTruthy();
    expect(screen.getByText('Изменён материал события: Название, Ссылка')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Удалён материал события' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Изменён порядок материалов' })).toBeTruthy();
    expect(
      screen.getByText('Настройки билетов изменены: Выдача билетов, Очный старт'),
    ).toBeTruthy();
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
