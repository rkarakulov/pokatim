// @vitest-environment jsdom
import type { TotpStatus } from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, renderApp } from '../../test/app';
import { TOTP_STATUS_QUERY_KEY } from './SecurityScreen';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    signOut: vi.fn(),
    getTotpStatus: vi.fn(),
    startTotpSetup: vi.fn(),
    confirmTotpSetup: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
    disableTotp: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const OFF: TotpStatus = { enabled: false, enabledAt: null, required: false, recoveryCodesLeft: 0 };
const ON: TotpStatus = {
  enabled: true,
  enabledAt: '2026-10-29T07:00:00.000Z',
  required: false,
  recoveryCodesLeft: 2,
};
const CODES = Array.from({ length: 10 }, (_, i) => `abcde-fgh${(i % 6) + 2}${(i % 5) + 2}`);
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/x:olga%40example.by?secret=JBSWY3DPEHPK3PXP',
};

beforeEach(() => {
  mocked.me.mockResolvedValue({
    ...ME.moderator,
    user: { ...ME.moderator.user, totp: { enabled: false, required: false } },
  });
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.resetAllMocks();
});

describe('«Безопасность» (ADR-0024, D9)', () => {
  it('вход из блока сотрудника; без 2FA — «Не подключена», рекомендация, подключение → коды → статус', async () => {
    mocked.getTotpStatus.mockResolvedValue(OFF);
    await renderApp('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Безопасность' }));
    expect(await screen.findByRole('heading', { name: 'Безопасность', level: 1 })).toBeTruthy();
    expect(await screen.findByText('Не подключена')).toBeTruthy();

    mocked.startTotpSetup.mockResolvedValue(SETUP);
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(
      await screen.findByRole('img', { name: 'QR-код для приложения-аутентификатора' }),
    ).toBeTruthy();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();

    mocked.confirmTotpSetup.mockResolvedValue({ recoveryCodes: CODES });
    mocked.getTotpStatus.mockResolvedValue({ ...ON, recoveryCodesLeft: 10 });
    fireEvent.change(screen.getByLabelText('Код из приложения'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(await screen.findByText(CODES[0]!)).toBeTruthy();
    expect(mocked.confirmTotpSetup).toHaveBeenCalledWith({ code: '123456' });
    // «кто я» перечитан — баннер «Обзора» и статус знают о 2FA
    await waitFor(() => expect(mocked.me.mock.calls.length).toBeGreaterThan(1));

    fireEvent.click(screen.getByLabelText('Я сохранил коды'));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('Осталось кодов восстановления: 10')).toBeTruthy();
  });

  it('подключение: неверный код — сообщение, экран подключения остаётся', async () => {
    mocked.getTotpStatus.mockResolvedValue(OFF);
    mocked.startTotpSetup.mockResolvedValue(SETUP);
    mocked.confirmTotpSetup.mockRejectedValue(httpError(400, 'TOTP_INVALID_CODE'));
    await renderApp('/account/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));
    fireEvent.change(await screen.findByLabelText('Код из приложения'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(
      await screen.findByText('Неверный код. Проверьте код и попробуйте ещё раз.'),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'QR-код для приложения-аутентификатора' })).toBeTruthy();
  });

  it('подключена: дата (Минск), осталось кодов и подсказка; перевыпуск — с кодом, новые коды', async () => {
    mocked.getTotpStatus.mockResolvedValue(ON);
    await renderApp('/account/security');
    expect(await screen.findByText(/^Подключена 29\.10\.2026/)).toBeTruthy();
    expect(screen.getByText(/Осталось кодов восстановления: 2/).textContent).toContain(
      'перевыпустите набор',
    );

    mocked.regenerateRecoveryCodes.mockResolvedValue({ recoveryCodes: CODES });
    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить коды' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Код из приложения'), {
      target: { value: '111 222' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перевыпустить коды' }));
    expect(await screen.findByText(CODES[1]!)).toBeTruthy();
    expect(mocked.regenerateRecoveryCodes).toHaveBeenCalledWith({ code: '111222' });
  });

  it('отключение кодом восстановления — 204, статус перечитан', async () => {
    mocked.getTotpStatus.mockResolvedValue(ON);
    mocked.disableTotp.mockResolvedValue(undefined);
    await renderApp('/account/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Отключить' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Использовать код восстановления' }),
    );
    mocked.getTotpStatus.mockResolvedValue(OFF);
    fireEvent.change(within(dialog).getByLabelText('Код восстановления'), {
      target: { value: 'abcde-fgh23' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отключить' }));
    expect(await screen.findByText('Не подключена')).toBeTruthy();
    expect(mocked.disableTotp).toHaveBeenCalledWith({ recoveryCode: 'abcde-fgh23' });
  });

  it('обязательная 2FA: «Отключить» — aria-disabled с пояснением, окно не открывается', async () => {
    mocked.getTotpStatus.mockResolvedValue({ ...ON, required: true });
    await renderApp('/account/security');
    const button = await screen.findByRole('button', { name: 'Отключить' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe(
      'Для администратора двухфакторная защита обязательна — отключить её нельзя.',
    );
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocked.disableTotp).not.toHaveBeenCalled();
  });

  it('подключение: confirm успешен, перечитка статуса падает — коды остаются, баннер «Повторить» (ревью pass 1)', async () => {
    mocked.getTotpStatus.mockResolvedValue(OFF);
    mocked.startTotpSetup.mockResolvedValue(SETUP);
    await renderApp('/account/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Подключить' }));
    mocked.confirmTotpSetup.mockResolvedValue({ recoveryCodes: CODES });
    mocked.getTotpStatus.mockRejectedValue(httpError(500, 'INTERNAL'));
    fireEvent.change(await screen.findByLabelText('Код из приложения'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));

    expect(await screen.findByText('Данные могли устареть')).toBeTruthy();
    expect(screen.getByText(CODES[0]!)).toBeTruthy();
    expect(screen.getByLabelText('Я сохранил коды')).toBeTruthy();

    mocked.getTotpStatus.mockResolvedValue({ ...ON, recoveryCodesLeft: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Данные могли устареть')).toBeNull());
    expect(screen.getByText(CODES[0]!)).toBeTruthy();
  });

  it('перевыпуск: успех, перечитка статуса падает — новые коды остаются (ревью pass 1)', async () => {
    mocked.getTotpStatus.mockResolvedValue(ON);
    await renderApp('/account/security');
    mocked.regenerateRecoveryCodes.mockResolvedValue({ recoveryCodes: CODES });
    mocked.getTotpStatus.mockRejectedValue(httpError(500, 'INTERNAL'));
    fireEvent.click(await screen.findByRole('button', { name: 'Перевыпустить коды' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Код из приложения'), {
      target: { value: '111222' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перевыпустить коды' }));
    expect(await screen.findByText('Данные могли устареть')).toBeTruthy();
    expect(screen.getByText(CODES[1]!)).toBeTruthy();
  });

  it('загрузка статуса — видимый скелетон строк и кнопок (ревью pass 3)', async () => {
    mocked.getTotpStatus.mockReturnValue(new Promise(() => undefined));
    await renderApp('/account/security');
    const progress = await screen.findByRole('progressbar', { name: 'Загрузка' });
    const lines = progress.querySelectorAll('.skeleton');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // неразрывный пробел: обычный схлопывается, строка без высоты
    for (const line of lines) expect(line.textContent).toBe('\u00a0');
  });

  it('перевыпуск идёт — окно не закрывается (Esc, «Отмена»): поздний ответ не подменит новые коды (ревью pass 3)', async () => {
    mocked.getTotpStatus.mockResolvedValue(ON);
    let answer: (value: { recoveryCodes: string[] }) => void = () => undefined;
    mocked.regenerateRecoveryCodes.mockReturnValue(new Promise((done) => (answer = done)));
    await renderApp('/account/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Перевыпустить коды' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Код из приложения'), {
      target: { value: '111 222' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перевыпустить коды' }));
    await waitFor(() => expect(mocked.regenerateRecoveryCodes).toHaveBeenCalled());
    const cancel = within(dialog).getByRole('button', { name: 'Отмена' });
    expect(cancel).toHaveProperty('disabled', true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => answer({ recoveryCodes: CODES }));
    expect(await screen.findByText(CODES[1]!)).toBeTruthy();
  });

  it('статус не загрузился (данных нет) — полноэкранная ошибка с повтором', async () => {
    mocked.getTotpStatus.mockRejectedValue(httpError(500, 'INTERNAL'));
    await renderApp('/account/security');
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
    expect(screen.queryByText('Данные могли устареть')).toBeNull();
  });

  it('первое открытие без сети («кто я» в кэше) — «Нет соединения» с повтором, не вечный скелетон (ревью pass 2)', async () => {
    mocked.getTotpStatus.mockResolvedValue(OFF);
    const { queryClient } = await renderApp('/account/security');
    expect(await screen.findByText('Не подключена')).toBeTruthy();
    onlineManager.setOnline(false);
    act(() => void queryClient.resetQueries({ queryKey: TOTP_STATUS_QUERY_KEY }));
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
