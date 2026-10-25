import { type ReactNode, useId } from 'react';

/**
 * Вычисляемое значение только для чтения (прототип «Сезон (по концу окна)»): пунктирная рамка, подпись, подсказка.
 * Не поле ввода — значение считает сервер или подсказка UI.
 */
export function ReadonlyField({
  label,
  value,
  help,
}: {
  label: ReactNode;
  value: ReactNode;
  help?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="field__label t-label" id={`${id}-label`}>
        {label}
      </div>
      <output
        className="readonly-field t-body"
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
      >
        {value}
      </output>
      {help ? (
        <span id={`${id}-help`} className="field__help t-meta">
          {help}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Причина недоступности действия под кнопкой: кнопка — `aria-disabled="true"` (остаётся в порядке фокуса) и
 * `aria-describedby` с `id` этого текста; нажатие такой кнопки обработчик игнорирует.
 */
export function DisabledReason({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="disabled-reason t-meta">
      {children}
    </p>
  );
}

/** Таблица или форма слева + правая колонка `--panel-rail-width` (прототип «Сезоны»). */
export function SplitLayout({ children, rail }: { children: ReactNode; rail: ReactNode }) {
  return (
    <div className="split">
      <div className="split__main">{children}</div>
      <aside className="split__rail">{rail}</aside>
    </div>
  );
}
