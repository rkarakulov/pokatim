// @vitest-environment jsdom
import type { AccountErasureRow } from '@pokatim/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    overview: vi.fn(),
    listAccountErasures: vi.fn(),
    retryAccountErasure: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const ID = '01890a5d-ac96-774b-bcce-b302099a8090';
const OTHER = '01890a5d-ac96-774b-bcce-b302099a8091';

const row = (overrides: Partial<AccountErasureRow> = {}): AccountErasureRow => ({
  userId: ID,
  deletedAt: '2026-10-01T10:00:00.000Z',
  failedAttempts: 5,
  lastFailure: { step: 'identity', code: 'ECONNECTION', at: '2026-10-01T11:30:00.000Z' },
  retryRequestedAt: null,
  ...overrides,
});

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;
const cellsOf = (text: string) =>
  within(rowOf(text))
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.overview.mockReturnValue(new Promise(() => undefined));
  mocked.listAccountErasures.mockResolvedValue({ items: [row()], nextCursor: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const reasonField = () => screen.getByRole('textbox', { name: /Причина/ });

describe('«Сбои удаления аккаунтов» (erasure-failures)', () => {
  it('строка без ПДн: подпись, удалён, шаг · код, время сбоя, попытки, повтор; без сбоя — «Сбоев не записано»', async () => {
    mocked.listAccountErasures.mockResolvedValue({
      items: [
        row(),
        row({
          userId: OTHER,
          failedAttempts: 0,
          lastFailure: null,
          retryRequestedAt: '2026-10-02T09:00:00.000Z',
        }),
      ],
      nextCursor: null,
    });
    await renderApp('/account-erasures');
    expect(await screen.findByRole('heading', { name: 'Сбои удаления аккаунтов' })).toBeTruthy();
    await screen.findByText('Участник ·9a8090');
    expect(cellsOf('Участник ·9a8090').slice(0, 6)).toEqual([
      'Участник ·9a8090',
      '1 октября 2026, 13:00',
      'Письмо и учётные данные · ECONNECTION',
      '1 октября 2026, 14:30',
      '5',
      '—',
    ]);
    expect(cellsOf('Участник ·9a8091').slice(0, 6)).toEqual([
      'Участник ·9a8091',
      '1 октября 2026, 13:00',
      'Сбоев не записано',
      '—',
      '0',
      '2 октября 2026, 12:00',
    ]);
    expect(mocked.listAccountErasures).toHaveBeenCalledWith({ limit: 50 });
  });

  it('пусто — «Зависших удалений нет»; «Показать ещё» — следующая страница по курсору', async () => {
    mocked.listAccountErasures.mockResolvedValueOnce({ items: [], nextCursor: null });
    await renderApp('/account-erasures');
    expect(await screen.findByText('Зависших удалений нет')).toBeTruthy();
    cleanup();

    mocked.listAccountErasures
      .mockResolvedValueOnce({ items: [row()], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [row({ userId: OTHER })], nextCursor: null });
    await renderApp('/account-erasures');
    fireEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText('Участник ·9a8091')).toBeTruthy();
    expect(mocked.listAccountErasures).toHaveBeenLastCalledWith({ limit: 50, cursor: 'c1' });
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('загрузка — скелетон под видимым заголовком; нет сети — «Нет соединения» с повтором', async () => {
    mocked.listAccountErasures.mockReturnValueOnce(new Promise(() => undefined));
    await renderApp('/account-erasures');
    expect(screen.getByRole('heading', { name: 'Сбои удаления аккаунтов' })).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    cleanup();

    mocked.listAccountErasures.mockRejectedValueOnce(networkError());
    await renderApp('/account-erasures');
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Участник ·9a8090')).toBeTruthy();
  });

  it('«Повторить удаление» — причина обязательна, запрос с причиной, сообщение и перечитывание', async () => {
    mocked.retryAccountErasure.mockResolvedValue({ queued: true });
    await renderApp('/account-erasures');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Повторить удаление: Участник ·9a8090' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Повторить удаление — Участник ·9a8090',
    });
    const confirm = within(dialog).getByRole('button', { name: 'Повторить удаление' });
    expect(
      confirm.hasAttribute('disabled') || confirm.getAttribute('aria-disabled') === 'true',
    ).toBe(true);
    fireEvent.change(reasonField(), { target: { value: 'Починили SMTP' } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mocked.retryAccountErasure).toHaveBeenCalledWith(ID, { reason: 'Починили SMTP' }),
    );
    expect(await screen.findByText(/Повтор поставлен в очередь/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(mocked.listAccountErasures).toHaveBeenCalledTimes(2));
  });

  it('повтор уже запрошен — сообщение без ошибки; удаление завершилось (409) — баннер и перечитывание', async () => {
    mocked.retryAccountErasure.mockResolvedValueOnce({ queued: false });
    await renderApp('/account-erasures');
    const open = async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: 'Повторить удаление: Участник ·9a8090' }),
      );
      fireEvent.change(reasonField(), { target: { value: 'Ещё раз' } });
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Повторить удаление',
        }),
      );
    };
    await open();
    expect(await screen.findByText(/Повтор уже запрошен недавно/)).toBeTruthy();

    mocked.retryAccountErasure.mockRejectedValueOnce(httpError(409, 'CONFLICT'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await open();
    expect(await screen.findByText('Удаление уже изменилось — список обновлён')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ошибка сервера при повторе — текст в окне, окно открыто', async () => {
    mocked.retryAccountErasure.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp('/account-erasures');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Повторить удаление: Участник ·9a8090' }),
    );
    fireEvent.change(reasonField(), { target: { value: 'Починили SMTP' } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повторить удаление' }));
    expect(
      await within(dialog).findByText('Не удалось сохранить. Повторите попытку.'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('без platform.stats (модератор) — «Нет доступа к разделу», запроса нет', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/account-erasures');
    expect(await screen.findByText('Нет доступа к разделу')).toBeTruthy();
    expect(mocked.listAccountErasures).not.toHaveBeenCalled();
  });
});
