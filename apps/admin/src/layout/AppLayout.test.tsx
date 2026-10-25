// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { currentHref, ME, networkError, renderApp, unauthorized } from '../test/app';

vi.mock('../api', () => ({
  api: {
    me: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    health: vi.fn(),
    resendVerification: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  mocked.health.mockResolvedValue({ status: 'ok', version: 'dev', checks: { database: 'up' } });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const sidebar = () => screen.getByRole('complementary');

describe('каркас панели (AC10)', () => {
  it('после входа — сайдбар: бренд, «Обзор», внизу «Имя · Роль · команда платформы» и «Выйти»', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    await renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
    const side = within(sidebar());
    expect(side.getByText('Покатим')).toBeTruthy();
    expect(side.getByRole('link', { name: 'Обзор' }).getAttribute('aria-current')).toBe('page');
    expect(side.getByText('Ольга · Администратор · команда платформы')).toBeTruthy();
    expect(side.getByRole('button', { name: 'Выйти' })).toBeTruthy();
    expect(screen.getByText('Разделы панели появятся здесь')).toBeTruthy();
    expect(await screen.findByText('Работает')).toBeTruthy();
  });

  it('organizer — подпись роли «Организатор»', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    await renderApp('/');
    expect(await screen.findByText('Ира · Организатор · команда платформы')).toBeTruthy();
  });

  it('неизвестный путь — «Страница не найдена» внутри каркаса со ссылкой на «Обзор»', async () => {
    mocked.me.mockResolvedValue(ME.moderator);
    await renderApp('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'Страница не найдена' })).toBeTruthy();
    expect(sidebar()).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'К обзору' }));
    expect(await screen.findByRole('heading', { name: 'Обзор' })).toBeTruthy();
  });

  it('«Выйти» — выход на сервере, кэш очищен, «Вход в панель» без «Сессия истекла»', async () => {
    mocked.me.mockResolvedValue(ME.admin);
    mocked.signOut.mockResolvedValue(undefined);
    const { router, queryClient } = await renderApp('/');
    await screen.findByRole('heading', { name: 'Обзор' });

    mocked.me.mockRejectedValue(unauthorized());
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(await screen.findByRole('heading', { name: 'Вход в панель' })).toBeTruthy();
    expect(mocked.signOut).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['admin', 'me'])).toBeUndefined();
    expect(screen.queryByText('Сессия истекла')).toBeNull();
    expect(currentHref(router)).toBe('/admin/sign-in');
  });

  it('«кто я» не загрузился из-за сети — «Нет соединения» с повтором; повтор открывает панель', async () => {
    mocked.me.mockRejectedValue(networkError());
    await renderApp('/');
    expect(await screen.findByText('Нет соединения')).toBeTruthy();

    mocked.me.mockResolvedValue(ME.admin);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Обзор' })).toBeTruthy());
  });
});
