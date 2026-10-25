// @vitest-environment jsdom
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: { me: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), health: vi.fn() },
}));

const mocked = vi.mocked(api);
const ok = { status: 'ok' as const, version: 'dev', checks: { database: 'up' as const } };

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.organizer);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.resetAllMocks();
});

/** Статус API на «Обзоре» (перенесено из прежней заглушки `App.test.tsx`; AGENTS.md §4.12). */
describe('«Обзор» — статус API', () => {
  it('заголовок виден сразу, на загрузке — скелетон', async () => {
    mocked.health.mockReturnValue(new Promise(() => undefined));
    await renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Загрузка' }).className).toContain('skeleton');
  });

  it('сетевая ошибка — сообщение о соединении и повтор', async () => {
    mocked.health.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(ok);
    await renderApp('/');
    expect(await screen.findByText(/Проверьте подключение к интернету/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Работает')).toBeTruthy();
  });

  it('статус — текстом словаря, а не кодом ответа', async () => {
    mocked.health.mockResolvedValueOnce({
      ...ok,
      status: 'degraded',
      checks: { database: 'down' },
    });
    await renderApp('/');
    expect(await screen.findByText('Работает с ограничениями')).toBeTruthy();
    expect(screen.queryByText('degraded')).toBeNull();
  });

  it('ошибка сервера и ответ неожиданной формы — «Сервис временно недоступен»', async () => {
    mocked.health.mockRejectedValueOnce(httpError(503, 'INTERNAL'));
    await renderApp('/');
    expect(await screen.findByText(/Сервис временно недоступен/)).toBeTruthy();
    cleanup();

    mocked.health.mockRejectedValueOnce(new Error('Invalid input'));
    await renderApp('/');
    expect(await screen.findByText(/Сервис временно недоступен/)).toBeTruthy();
  });

  it('ошибка обновления: значение остаётся, баннер «Данные могли устареть» с повтором', async () => {
    mocked.health
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(ok);
    const { queryClient } = await renderApp('/');
    expect(await screen.findByText('Работает')).toBeTruthy();

    await queryClient.refetchQueries({ queryKey: ['health'] }).catch(() => undefined);
    expect(await screen.findByText('Данные могли устареть')).toBeTruthy();
    expect(screen.getByText('Работает')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await vi.waitFor(() => expect(mocked.health).toHaveBeenCalledTimes(3));
  });

  it('нет сети до загрузки статуса (запрос на паузе) — «Нет соединения» с повтором; сеть вернулась — статус', async () => {
    mocked.health.mockReturnValue(new Promise(() => undefined));
    const { queryClient } = await renderApp('/');
    await screen.findByRole('heading', { name: 'Обзор' });

    mocked.health.mockResolvedValue(ok);
    onlineManager.setOnline(false);
    // перезапрос встаёт на паузу до возвращения сети — не ждём его
    act(() => void queryClient.resetQueries({ queryKey: ['health'] }));

    expect(await screen.findByText(/Проверьте подключение к интернету/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name: 'Загрузка' })).toBeNull();

    act(() => onlineManager.setOnline(true));
    expect(await screen.findByText('Работает')).toBeTruthy();
  });
});
