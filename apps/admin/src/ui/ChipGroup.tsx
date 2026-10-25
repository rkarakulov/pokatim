import { type ReactNode, useId } from 'react';

export interface ChipGroupProps<T extends string> {
  label: ReactNode;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  error?: string;
  disabled?: boolean;
  /** Замок у подписи (поле зафиксировано). */
  labelAside?: ReactNode;
}

/**
 * Мультивыбор чипами с галочкой (прототип «Покрытие · можно несколько»): каждый чип — кнопка `aria-pressed`
 * (Tab, Пробел и Enter — нативно), выбранные — заливка ink. Порядок значения — порядок вариантов.
 */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  disabled = false,
  labelAside,
}: ChipGroupProps<T>) {
  const id = useId();
  const toggle = (option: T) => {
    const next = value.includes(option)
      ? value.filter((item) => item !== option)
      : options.map((item) => item.value).filter((item) => item === option || value.includes(item));
    onChange(next);
  };
  return (
    <div className="field">
      <div className="field__label t-label" id={`${id}-label`}>
        {label}
        {labelAside}
      </div>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        className="chips"
      >
        {options.map((option) => {
          const pressed = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className="chip t-body"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => toggle(option.value)}
            >
              <span className="chip__check" aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p id={`${id}-error`} className="field__error t-meta" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
