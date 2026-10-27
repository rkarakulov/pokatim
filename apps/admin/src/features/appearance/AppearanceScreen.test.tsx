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
const NAMES = [
  'Классика',
  'Атлас',
  'Хронометр',
  'Планировщик',
  'Журнал',
  'Навигация',
  'Типографика',
];

const saved = (overrides: Partial<PanelAppearance> = {}): PanelAppearance => ({
  themeId: 'classic',
  version: 0,
  updatedAt: null,
  ...overrides,
});

const open = () => renderApp('/appearance');
const radio = (name: string) => screen.getByRole('radio', { name });
const saveButton = () => screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement;

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.getAppearance.mockResolvedValue(saved());
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.resetAllMocks();
});

describe('«Оформление приложения» (app-themes D1, AC6)', () => {
  it('загрузка — заголовок и 7 скелетонов карточек', async () => {
    mocked.getAppearance.mockReturnValue(new Promise(() => undefined));
    await open();
    expect(await screen.findByRole('heading', { name: 'Оформление приложения' })).toBeTruthy();
    expect(screen.getAllByTestId('skeleton-theme-card')).toHaveLength(7);
    expect(screen.getByTestId('appearance-loading').getAttribute('aria-busy')).toBe('true');
  });

  it('радио — точное имя темы, описание и превью — описание радио', async () => {
    await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    const atlas = radio('Атлас');
    const describedBy = atlas.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toContain('Превью появится позже');
    expect(radio('Классика').getAttribute('aria-describedby')).toBeTruthy();
  });

  it('первая загрузка без сети — «Нет соединения» с повтором, не бесконечный скелетон', async () => {
    const { queryClient } = await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    onlineManager.setOnline(false);
    act(() => void queryClient.resetQueries({ queryKey: ['admin', 'appearance'] }));
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.getByText('Нет соединения')).toBeTruthy();
    expect(screen.queryAllByTestId('skeleton-theme-card')).toHaveLength(0);
  });

  it('7 карточек в порядке APP_THEME_IDS, текущая отмечена; «Сохранить» неактивна без изменений', async () => {
    mocked.getAppearance.mockResolvedValue(saved({ themeId: 'atlas', version: 2 }));
    await open();
    const group = await screen.findByRole('group', { name: 'Тема приложения' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(
      radios.map(
        (input) => input.closest('label')?.querySelector('.card-radio__title')?.textContent,
      ),
    ).toEqual(NAMES);
    expect((radio('Атлас') as HTMLInputElement).checked).toBe(true);
    const current = screen.getByText('Сейчас в приложении');
    expect(current.closest('label')).toBe(radio('Атлас').closest('label'));
    expect(screen.getByText(/Панель «Протокол» остаётся в своей теме/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('превью: у «Классики» — цветной мини-макет, у остальных — «Превью появится позже»', async () => {
    await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    const classic = radio('Классика').closest('label') as HTMLElement;
    expect(classic.querySelector('.theme-preview--palette')).toBeTruthy();
    expect(within(classic).queryByText('Превью появится позже')).toBeNull();
    expect(screen.getAllByText('Превью появится позже')).toHaveLength(6);
  });

  it('выбор и сохранение: тело { themeId, version }, баннер успеха, новая тема — текущая, журнал перечитывается', async () => {
    mocked.updateAppearance.mockResolvedValue(
      saved({ themeId: 'chrono', version: 1, updatedAt: '2026-10-27T10:00:00.000Z' }),
    );
    const { queryClient } = await open();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await screen.findByRole('group', { name: 'Тема приложения' });

    fireEvent.click(radio('Хронометр'));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    expect(
      await screen.findByText('Тема сохранена. Приложение применит её в течение минуты.'),
    ).toBeTruthy();
    expect(mocked.updateAppearance).toHaveBeenCalledWith({ themeId: 'chrono', version: 0 });
    expect(screen.getByText('Сейчас в приложении').closest('label')).toBe(
      radio('Хронометр').closest('label'),
    );
    expect(saveButton().disabled).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'audit'] });
  });

  it('409 — ConflictBanner; «Обновить» перечитывает и сбрасывает выбор к серверному', async () => {
    mocked.updateAppearance.mockRejectedValue(httpError(409, 'CONFLICT'));
    await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    fireEvent.click(radio('Журнал'));
    fireEvent.click(saveButton());
    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();

    mocked.getAppearance.mockResolvedValue(saved({ themeId: 'planner', version: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect((radio('Планировщик') as HTMLInputElement).checked).toBe(true));
    expect(screen.queryByText('Запись изменили — обновите страницу')).toBeNull();
    expect(screen.getByText('Сейчас в приложении').closest('label')).toBe(
      radio('Планировщик').closest('label'),
    );
    expect(saveButton().disabled).toBe(true);
  });

  it('409 → «Обновить» → ошибка GET: конфликт и выбор остаются, баннер с повтором; повтор успешен — сброс', async () => {
    mocked.updateAppearance.mockRejectedValue(httpError(409, 'CONFLICT'));
    await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    fireEvent.click(radio('Журнал'));
    fireEvent.click(saveButton());
    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();

    mocked.getAppearance.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    expect(screen.getByText('Запись изменили — обновите страницу')).toBeTruthy();
    expect((radio('Журнал') as HTMLInputElement).checked).toBe(true);

    mocked.getAppearance.mockResolvedValue(saved({ themeId: 'planner', version: 3 }));
    fireEvent.click(retry);
    await waitFor(() => expect((radio('Планировщик') as HTMLInputElement).checked).toBe(true));
    expect(screen.queryByText('Запись изменили — обновите страницу')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });

  it('прочая ошибка сохранения — баннер ошибки, выбор сохраняется', async () => {
    mocked.updateAppearance.mockRejectedValue(httpError(500, 'INTERNAL'));
    await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    fireEvent.click(radio('Навигация'));
    fireEvent.click(saveButton());
    expect(await screen.findByText('Не удалось сохранить тему')).toBeTruthy();
    expect((radio('Навигация') as HTMLInputElement).checked).toBe(true);
  });

  it('ошибка загрузки — «Повторить» перечитывает', async () => {
    mocked.getAppearance.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('group', { name: 'Тема приложения' })).toBeTruthy();
    expect(mocked.getAppearance).toHaveBeenCalledTimes(2);
  });
});
