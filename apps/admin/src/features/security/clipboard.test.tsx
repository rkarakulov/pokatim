// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecoveryCodesView } from './RecoveryCodesView';
import { TotpEnrollment } from './TotpEnrollment';

/** Копирование кодов и ключа (ревью pass 6, LOW): нет API буфера или отказ — сообщение, а не молчание. */
const CODES = ['abcde-fgh23', 'bcdef-ghi34'];
const SETUP = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/x:olga%40example.by?secret=JBSWY3DPEHPK3PXP',
};
const CODES_FAILED = 'Не удалось скопировать — выделите текст вручную или скачайте файл.';
const SECRET_FAILED = 'Не удалось скопировать — введите ключ вручную.';

function stubClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

const renderCodes = () =>
  render(
    <RecoveryCodesView
      codes={CODES}
      email="olga@example.by"
      continueLabel="Готово"
      onContinue={vi.fn()}
    />,
  );
const renderEnrollment = () =>
  render(<TotpEnrollment setup={SETUP} busy={false} onConfirm={vi.fn()} />);

afterEach(() => {
  cleanup();
  stubClipboard(undefined);
});

describe('коды восстановления: «Скопировать»', () => {
  it('успех — «Скопировано» (status)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    renderCodes();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect((await screen.findByText('Скопировано')).closest('[role="status"]')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
  });

  it('отказ промиса — сообщение в alert', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    renderCodes();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect((await screen.findByText(CODES_FAILED)).closest('[role="alert"]')).toBeTruthy();
  });

  it('нет API буфера — сообщение в alert', async () => {
    stubClipboard(undefined);
    renderCodes();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect((await screen.findByText(CODES_FAILED)).closest('[role="alert"]')).toBeTruthy();
  });
});

describe('ключ подключения: «Скопировать»', () => {
  it('отказ промиса — сообщение в alert', async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    renderEnrollment();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect((await screen.findByText(SECRET_FAILED)).closest('[role="alert"]')).toBeTruthy();
  });

  it('нет API буфера — сообщение в alert; успех после — «Скопировано»', async () => {
    stubClipboard(undefined);
    renderEnrollment();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect((await screen.findByText(SECRET_FAILED)).closest('[role="alert"]')).toBeTruthy();

    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    expect(await screen.findByRole('button', { name: 'Скопировано' })).toBeTruthy();
    expect(screen.queryByText(SECRET_FAILED)).toBeNull();
  });
});
