import { type ReactNode, useId } from 'react';

export interface CardRadioOption<T extends string> {
  value: T;
  /** Имя варианта — доступное имя радио и заголовок карточки. */
  label: string;
  /** Содержимое карточки под заголовком (превью, описание, бейдж). */
  children?: ReactNode;
}

export interface CardRadioGroupProps<T extends string> {
  legend: string;
  options: readonly CardRadioOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
}

/**
 * Радиогруппа карточек с произвольным содержимым (у `RadioGroup` подпись — только строка): нативные
 * `input[type=radio]` в `fieldset` (стрелки и Tab — браузера), вся карточка — `label` (клик по карточке). Имя радио —
 * только заголовок (`aria-labelledby`), содержимое — описание (`aria-describedby`). Кандидат в `admin-kit`.
 */
export function CardRadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
}: CardRadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="card-radios">
      <legend className="field__label t-label">{legend}</legend>
      <div className="card-radios__grid">
        {options.map((option) => {
          const checked = value === option.value;
          const titleId = `${name}-${option.value}-title`;
          const bodyId = `${name}-${option.value}-body`;
          return (
            <label
              key={option.value}
              className={`card-radio${checked ? ' card-radio--checked' : ''}`}
            >
              <span className="card-radio__head">
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={checked}
                  aria-labelledby={titleId}
                  aria-describedby={option.children ? bodyId : undefined}
                  onChange={() => onChange(option.value)}
                />
                <span id={titleId} className="card-radio__title t-title-sm">
                  {option.label}
                </span>
              </span>
              {option.children ? (
                <span id={bodyId} className="card-radio__body">
                  {option.children}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
