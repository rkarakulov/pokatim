import { useId } from 'react';

export interface RadioGroupProps<T extends string> {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** Фокус при открытии окна — на первый вариант (`autoFocus`). */
  autoFocusFirst?: boolean;
}

/**
 * Радиогруппа панели: нативные `input[type=radio]` в `fieldset` (стрелки и Tab — браузера), варианты — квадратные
 * строки 36 px (прототип «Отменить гонку?»).
 */
export function RadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  autoFocusFirst = false,
}: RadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="radios">
      <legend className="field__label t-label">{legend}</legend>
      {options.map((option, index) => (
        <label key={option.value} className="radio t-body">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            autoFocus={autoFocusFirst && index === 0}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
