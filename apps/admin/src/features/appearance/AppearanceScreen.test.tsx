// @vitest-environment jsdom
import type { PanelAppearance } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp } from '../../test/app';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    getAppearance: vi.fn(),
    updateAppearance: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

const saved = (overrides: Partial<PanelAppearance> = {}): PanelAppearance => ({
  decor: 'none',
  version: 0,
  updatedAt: null,
  ...overrides,
});

const open = () => renderApp('/appearance');
const toggle = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.getAppearance.mockResolvedValue(saved());
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.resetAllMocks();
});

describe('«Оформление приложения» — только сезонный декор (user-theme AC5)', () => {
  it('загрузка — заголовок и скелетон блока декора', async () => {
    mocked.getAppearance.mockReturnValue(new Promise(() => undefined));
    await open();
    expect(await screen.findByRole('heading', { name: 'Оформление приложения' })).toBeTruthy();
    expect(screen.getByTestId('appearance-loading').getAttribute('aria-busy')).toBe('true');
  });

  it('выбора тем нет: ни радио, ни «Сохранить», ни превью; подсказка — тема у райдера', async () => {
    await open();
    await screen.findByRole('region', { name: 'Сезонный декор' });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Тема приложения' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(document.querySelector('.theme-preview')).toBeNull();
    expect(screen.getByText(/Тему каждый райдер выбирает сам/)).toBeTruthy();
  });

  it('первая загрузка без сети — «Нет соединения» с повтором, не бесконечный скелетон', async () => {
    const { queryClient } = await open();
    await screen.findByRole('region', { name: 'Сезонный декор' });
    onlineManager.setOnline(false);
    act(() => void queryClient.resetQueries({ queryKey: ['admin', 'appearance'] }));
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.getByText('Нет соединения')).toBeTruthy();
    expect(screen.queryByTestId('appearance-loading')).toBeNull();
  });

  it('ошибка загрузки — «Повторить» перечитывает', async () => {
    mocked.getAppearance.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('region', { name: 'Сезонный декор' })).toBeTruthy();
    expect(mocked.getAppearance).toHaveBeenCalledTimes(2);
  });

  it('выключен — одна кнопка включает: тело { decor, version }, состояние и журнал обновляются', async () => {
    mocked.updateAppearance.mockResolvedValue(saved({ decor: 'halloween', version: 1 }));
    const { queryClient } = await open();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const region = await screen.findByRole('region', { name: 'Сезонный декор' });
    expect(within(region).getByText('Хеллоуинский декор выключен')).toBeTruthy();

    fireEvent.click(toggle(/Включить хеллоуинский декор/));
    expect(
      await screen.findByText('Декор включён. Приложение покажет его в течение минуты.'),
    ).toBeTruthy();
    expect(mocked.updateAppearance).toHaveBeenCalledWith({ decor: 'halloween', version: 0 });
    expect(within(region).getByText('Хеллоуинский декор включён')).toBeTruthy();
    expect(toggle(/Выключить хеллоуинский декор/)).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'audit'] });
  });

  it('включён — кнопка выключает', async () => {
    mocked.getAppearance.mockResolvedValue(saved({ decor: 'halloween', version: 4 }));
    mocked.updateAppearance.mockResolvedValue(saved({ decor: 'none', version: 5 }));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Выключить хеллоуинский декор/ }));
    expect(
      await screen.findByText('Декор выключен. Приложение уберёт его в течение минуты.'),
    ).toBeTruthy();
    expect(mocked.updateAppearance).toHaveBeenCalledWith({ decor: 'none', version: 4 });
  });

  it('409 — ConflictBanner; «Обновить» перечитывает и снимает баннер', async () => {
    mocked.updateAppearance.mockRejectedValue(httpError(409, 'CONFLICT'));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Включить хеллоуинский декор/ }));
    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();

    mocked.getAppearance.mockResolvedValue(saved({ decor: 'halloween', version: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() =>
      expect(screen.queryByText('Запись изменили — обновите страницу')).toBeNull(),
    );
    expect(screen.getByText('Хеллоуинский декор включён')).toBeTruthy();
  });

  it('прочая ошибка — баннер ошибки декора', async () => {
    mocked.updateAppearance.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Включить хеллоуинский декор/ }));
    expect(await screen.findByText('Не удалось переключить декор')).toBeTruthy();
  });
});
