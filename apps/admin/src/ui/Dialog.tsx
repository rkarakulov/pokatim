import { type ReactNode, useId, useLayoutEffect, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Модальное окно на нативном `<dialog>` (`showModal()`: ловушка фокуса и подложка — браузера). При открытии фокус —
 * на первое поле (`autoFocus` у потомка или первый фокусируемый элемент), при закрытии — обратно на элемент,
 * открывший окно. Esc и «Отмена» закрывают.
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // layout-эффект: фокус возвращается в том же коммите, что убирает окно, — не отдельной задачей планировщика
  // после обновления из промиса (иначе между ними фокус на body)
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // jsdom и старые браузеры без showModal — открытие атрибутом
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    const first = dialog.querySelector<HTMLElement>(
      '[autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])',
    );
    first?.focus();
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
      trigger?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: закрывает родитель (состояние open), не браузер в обход React
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <h2 id={titleId} className="t-panel-title-sm">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
