// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReasonDialog } from './ReasonDialog';

afterEach(cleanup);

function Harness({
  onConfirm,
  destructive,
}: {
  onConfirm: (reason: string) => Promise<void>;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Снять роль
      </button>
      <ReasonDialog
        open={open}
        title="Снять роль: Мария"
        consequences="Сессии панели сотрудника завершатся. Доступ к приложению сохранится."
        confirmLabel="Подтвердить"
        destructive={destructive}
        errorText={() => 'Нельзя оставить панель без администратора.'}
        onConfirm={onConfirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const reason = () => screen.getByLabelText('Причина (обязательно)');
const confirm = () => screen.getByRole('button', { name: 'Подтвердить' });

function open(onConfirm = vi.fn().mockResolvedValue(undefined), destructive = true) {
  render(<Harness onConfirm={onConfirm} destructive={destructive} />);
  const trigger = screen.getByRole('button', { name: 'Снять роль' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, onConfirm };
}

describe('ReasonDialog (AC11)', () => {
  it('открывается с заголовком и последствиями, фокус — на поле причины', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Снять роль: Мария' })).toBeTruthy();
    expect(
      screen.getByText('Сессии панели сотрудника завершатся. Доступ к приложению сохранится.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(reason());
  });

  it('подтверждение неактивно без причины и с причиной короче 3 символов; разрушительный вариант', () => {
    open();
    expect(confirm()).toHaveProperty('disabled', true);
    fireEvent.change(reason(), { target: { value: '  ок ' } });
    expect(confirm()).toHaveProperty('disabled', true);
    fireEvent.change(reason(), { target: { value: 'ушла из команды' } });
    expect(confirm()).toHaveProperty('disabled', false);
    expect(confirm().className).toContain('button--danger-solid');
  });

  it('подтверждение — причина без пробелов по краям, окно закрывается, фокус — на кнопку-триггер', async () => {
    const { trigger, onConfirm } = open();
    // Фокус в момент удаления окна из DOM: закрытие после await — не дискретное обновление, и восстановление
    // фокуса в пассивном эффекте отставало от DOM на задачу планировщика (флак CI: фокус на body).
    let focusOnClose: Element | null = null;
    const observer = new MutationObserver(() => {
      if (!document.querySelector('dialog')) focusOnClose ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    fireEvent.change(reason(), { target: { value: '  ушла из команды  ' } });
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Снять роль:/ })).toBeNull());
    observer.disconnect();
    expect(onConfirm).toHaveBeenCalledWith('ушла из команды');
    expect(focusOnClose).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('Esc и «Отмена» закрывают без подтверждения и возвращают фокус', () => {
    const { trigger, onConfirm } = open();
    fireEvent.keyDown(reason(), { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: /Снять роль:/ })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /Отмена/ }));
    expect(screen.queryByRole('heading', { name: /Снять роль:/ })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ошибка сервера — текст в окне, окно остаётся открытым, причина сохранена', async () => {
    open(vi.fn().mockRejectedValue(new Error('409')));
    fireEvent.change(reason(), { target: { value: 'последний админ' } });
    fireEvent.click(confirm());
    expect(await screen.findByText('Нельзя оставить панель без администратора.')).toBeTruthy();
    expect((reason() as HTMLTextAreaElement).value).toBe('последний админ');
  });

  it('confirmDisabled — подтверждение неактивно и при достаточной причине (форма окна не готова)', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ReasonDialog
        open
        title="Выдать"
        consequences="Последствия"
        confirmLabel="Подтвердить"
        confirmDisabled
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(reason(), { target: { value: 'технический сбой' } });
    expect(confirm()).toHaveProperty('disabled', true);
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
    rerender(
      <ReasonDialog
        open
        title="Выдать"
        consequences="Последствия"
        confirmLabel="Подтвердить"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    expect(confirm()).toHaveProperty('disabled', false);
  });
});
