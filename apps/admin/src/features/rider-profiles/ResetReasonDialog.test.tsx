// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResetReasonDialog } from './ResetReasonDialog';

afterEach(cleanup);

const WARNING = 'Не повторяйте имя или клуб в причине: она навсегда остаётся в журнале действий.';

function Harness({ onConfirm }: { onConfirm: (body: unknown) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть
      </button>
      <ResetReasonDialog
        open={open}
        title="Сбросить клуб?"
        consequences="Клуб исчезнет из профиля."
        confirmLabel="Сбросить клуб"
        errorText={() => 'Не удалось сохранить'}
        onConfirm={onConfirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
const confirm = () => screen.getByRole('button', { name: 'Сбросить клуб' });
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('ResetReasonDialog (profile-moderation-d11, D11-1)', () => {
  it('«Другое» — фокус в поле текста; «Отмена» и повторное открытие — выбор и текст сброшены', async () => {
    render(<Harness onConfirm={vi.fn().mockResolvedValue(undefined)} />);
    open();
    fireEvent.click(radio('Другое'));
    const field = await screen.findByLabelText('Причина (обязательно)');
    expect(document.activeElement).toBe(field);
    expect(screen.getByText(WARNING)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'Реклама' } });
    fireEvent.click(screen.getByRole('button', { name: /Отмена/ }));
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    expect(radio('Другое').checked).toBe(false);
    expect(screen.queryByLabelText('Причина (обязательно)')).toBeNull();
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(confirm().hasAttribute('disabled')).toBe(true);
  });

  it('ошибка сервера — текст в окне, окно открыто, выбор на месте; повтор — успех и закрытие', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValueOnce(undefined);
    render(<Harness onConfirm={onConfirm} />);
    open();
    fireEvent.click(radio('Неприемлемый клуб'));
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe('Не удалось сохранить');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(radio('Неприемлемый клуб').checked).toBe(true);
    expect(onConfirm).toHaveBeenLastCalledWith({ reason: 'club' });

    fireEvent.click(confirm());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
