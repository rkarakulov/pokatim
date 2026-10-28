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
  decor: 'none',
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
    // app-themes C: превью у всех тем цветное, в описании — гарнитура темы
    expect(document.getElementById(describedBy)?.textContent).toContain('Шрифт: Manrope');
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

  it('превью: у всех 7 тем — цветной мини-макет и подпись шрифта; «Превью появится позже» нет (app-themes C1)', async () => {
    await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    expect(document.querySelectorAll('.theme-preview--palette')).toHaveLength(7);
    expect(screen.queryByText('Превью появится позже')).toBeNull();
    const atlas = radio('Атлас').closest('label') as HTMLElement;
    expect(within(atlas).getByText(/Шрифт: Manrope/)).toBeTruthy();
    const classic = radio('Классика').closest('label') as HTMLElement;
    expect(within(classic).getByText(/Шрифт: Playfair Display/)).toBeTruthy();
    const mocks = atlas.querySelectorAll<HTMLElement>('.theme-preview__mock');
    expect(mocks).toHaveLength(2);
    expect(mocks[0]?.style.getPropertyValue('--preview-radius')).toBe('8px');
    expect(within(atlas).getByText(/Светлая и тёмная — по системе/)).toBeTruthy();
    const chrono = radio('Хронометр').closest('label') as HTMLElement;
    expect(chrono.querySelectorAll('.theme-preview__mock')).toHaveLength(1);
    expect(within(chrono).getByText(/Всегда тёмная/)).toBeTruthy();
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

  it('незавершённый выбор держит исходную версию: данные обновились (другой админ) — Сохранить шлёт старую версию → 409', async () => {
    mocked.updateAppearance.mockRejectedValue(httpError(409, 'CONFLICT'));
    const { queryClient } = await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    fireEvent.click(radio('Журнал'));

    mocked.getAppearance.mockResolvedValue(saved({ themeId: 'atlas', version: 1 }));
    await act(() => queryClient.refetchQueries({ queryKey: ['admin', 'appearance'] }));
    await waitFor(() =>
      expect(screen.getByText('Сейчас в приложении').closest('label')).toBe(
        radio('Атлас').closest('label'),
      ),
    );
    expect((radio('Журнал') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(saveButton());
    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();
    expect(mocked.updateAppearance).toHaveBeenCalledWith({ themeId: 'journal', version: 0 });
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

describe('сезонный декор (halloween-decor AC3)', () => {
  const toggle = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

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

  it('незавершённый выбор темы после своего переключения декора — сохраняется со свежей версией', async () => {
    mocked.updateAppearance
      .mockResolvedValueOnce(saved({ decor: 'halloween', version: 1 }))
      .mockResolvedValueOnce(saved({ themeId: 'journal', decor: 'halloween', version: 2 }));
    await open();
    await screen.findByRole('group', { name: 'Тема приложения' });
    fireEvent.click(radio('Журнал'));
    fireEvent.click(toggle(/Включить хеллоуинский декор/));
    await screen.findByText('Хеллоуинский декор включён');
    expect((radio('Журнал') as HTMLInputElement).checked).toBe(true);

    fireEvent.click(saveButton());
    await screen.findByText('Тема сохранена. Приложение применит её в течение минуты.');
    expect(mocked.updateAppearance).toHaveBeenLastCalledWith({ themeId: 'journal', version: 1 });
  });

  it('409 — ConflictBanner', async () => {
    mocked.updateAppearance.mockRejectedValue(httpError(409, 'CONFLICT'));
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /Включить хеллоуинский декор/ }));
    expect(await screen.findByText('Запись изменили — обновите страницу')).toBeTruthy();
  });
});
