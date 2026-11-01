// @vitest-environment jsdom
import type { FailedJobRow, FailedJobsView } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    overview: vi.fn(),
    listFailedJobs: vi.fn(),
    retryFailedJob: vi.fn(),
    deleteFailedJob: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const EVENT = '01890a5d-ac96-774b-bcce-b302099a8090';

const row = (overrides: Partial<FailedJobRow> = {}): FailedJobRow => ({
  queue: 'panel-email',
  jobId: EVENT,
  name: 'panel.invitation-email-requested',
  attemptsMade: 5,
  attempts: 5,
  error: '550 [e-mail] rejected',
  createdAt: '2026-10-01T10:00:00.000Z',
  failedAt: '2026-10-01T11:30:00.000Z',
  outboxEventId: EVENT,
  ...overrides,
});

const viewOf = (items: FailedJobRow[], extra: Partial<FailedJobsView> = {}): FailedJobsView => ({
  queues: [
    { queue: 'track-processing', failed: 0 },
    { queue: 'panel-email', failed: items.length },
  ],
  items,
  outbox: { stuck: 0, oldestAt: null, items: [] },
  ...extra,
});

const LABEL = `panel-email · ${EVENT}`;
const reasonField = () => screen.getByRole('textbox', { name: /Причина/ });
const cellsOf = (text: string) =>
  within(screen.getByText(text).closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.overview.mockReturnValue(new Promise(() => undefined));
  mocked.listFailedJobs.mockResolvedValue(viewOf([row()]));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('«Упавшие задачи» (admin-failed-jobs)', () => {
  it('строка: очередь, задача и id, ошибка, попытки, время; фильтр — только очереди с провалами', async () => {
    mocked.listFailedJobs.mockResolvedValue(
      viewOf([row(), row({ jobId: 'x-1', error: null, attempts: null, attemptsMade: 2 })]),
    );
    await renderApp('/failed-jobs');
    expect(await screen.findByRole('heading', { name: 'Упавшие задачи' })).toBeTruthy();
    await screen.findByText(EVENT);
    expect(cellsOf(EVENT).slice(0, 5)).toEqual([
      'panel-email',
      `panel.invitation-email-requested${EVENT}`,
      '550 [e-mail] rejected',
      '5 из 5',
      '1 октября 2026, 14:30',
    ]);
    expect(cellsOf('x-1').slice(2, 4)).toEqual(['Текст ошибки не записан', '2']);
    const select = screen.getByRole('combobox', { name: 'Очередь' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Все очереди (2)', 'panel-email (2)']);
    expect(mocked.listFailedJobs).toHaveBeenCalledWith({ limit: 50 });

    fireEvent.change(select, { target: { value: 'panel-email' } });
    await waitFor(() =>
      expect(mocked.listFailedJobs).toHaveBeenLastCalledWith({ limit: 50, queue: 'panel-email' }),
    );
  });

  it('пусто — «Упавших задач нет»; outbox застрял — предупреждение с числом и самым давним', async () => {
    mocked.listFailedJobs.mockResolvedValue(
      viewOf([], {
        outbox: {
          stuck: 3,
          oldestAt: '2026-10-01T10:00:00.000Z',
          items: [{ id: EVENT, type: 'tickets.issued', createdAt: '2026-10-01T10:00:00.000Z' }],
        },
      }),
    );
    await renderApp('/failed-jobs');
    expect(await screen.findByText('Упавших задач нет')).toBeTruthy();
    expect(screen.getByText('Не опубликованные события')).toBeTruthy();
    expect(
      screen.getByText(/дольше 10 мин: 3\. Самое давнее — 1 октября 2026, 13:00/),
    ).toBeTruthy();
    expect(screen.getByText('tickets.issued · 1 октября 2026, 13:00')).toBeTruthy();
  });

  it('загрузка — скелетон под заголовком; нет сети — «Нет соединения» с повтором', async () => {
    mocked.listFailedJobs.mockReturnValueOnce(new Promise(() => undefined));
    await renderApp('/failed-jobs');
    expect(screen.getByRole('heading', { name: 'Упавшие задачи' })).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    cleanup();

    mocked.listFailedJobs.mockRejectedValueOnce(networkError());
    await renderApp('/failed-jobs');
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText(EVENT)).toBeTruthy();
  });

  it('«Повторить» — причина обязательна, запрос с причиной, сообщение и перечитывание', async () => {
    mocked.retryFailedJob.mockResolvedValue(undefined);
    await renderApp('/failed-jobs');
    fireEvent.click(await screen.findByRole('button', { name: `Повторить задачу ${LABEL}` }));
    const dialog = await screen.findByRole('dialog', { name: `Повторить задачу — ${LABEL}` });
    const confirm = within(dialog).getByRole('button', { name: 'Повторить' });
    expect(
      confirm.hasAttribute('disabled') || confirm.getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    fireEvent.change(reasonField(), { target: { value: 'Починили SMTP' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.retryFailedJob).toHaveBeenCalledWith('panel-email', EVENT, {
        reason: 'Починили SMTP',
      }),
    );
    expect(await screen.findByText('Задача поставлена в очередь заново')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mocked.listFailedJobs).toHaveBeenCalledTimes(2));
  });

  it('«Удалить» — предупреждение о необратимости; задача уже изменилась (409) — баннер и перечитывание', async () => {
    mocked.deleteFailedJob.mockRejectedValueOnce(httpError(409, 'CONFLICT'));
    await renderApp('/failed-jobs');
    fireEvent.click(await screen.findByRole('button', { name: `Удалить задачу ${LABEL}` }));
    const dialog = await screen.findByRole('dialog', { name: `Удалить задачу — ${LABEL}` });
    expect(within(dialog).getByText(/Действие необратимо/)).toBeTruthy();
    fireEvent.change(reasonField(), { target: { value: 'Дубль события' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Задача уже изменилась — список обновлён')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mocked.listFailedJobs).toHaveBeenCalledTimes(2));
  });

  it('ошибка сервера при действии — текст в окне, окно открыто', async () => {
    mocked.retryFailedJob.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp('/failed-jobs');
    fireEvent.click(await screen.findByRole('button', { name: `Повторить задачу ${LABEL}` }));
    fireEvent.change(reasonField(), { target: { value: 'Починили SMTP' } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повторить' }));
    expect(
      await within(dialog).findByText('Не удалось сохранить. Повторите попытку.'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('без platform.stats (модератор) — «Нет доступа к разделу», запроса нет', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/failed-jobs');
    expect(await screen.findByText('Нет доступа к разделу')).toBeTruthy();
    expect(mocked.listFailedJobs).not.toHaveBeenCalled();
  });
});
