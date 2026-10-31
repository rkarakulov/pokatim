import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

interface FieldFrameProps {
  label: ReactNode;
  /** Ссылка или подсказка справа от подписи («Забыли пароль?»). */
  labelAside?: ReactNode;
  error?: string;
  help?: ReactNode;
}

function useFieldIds(error?: string, help?: ReactNode) {
  const id = useId();
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errorId : '', help ? helpId : ''].filter(Boolean).join(' ');
  return { id, errorId, helpId, describedBy: describedBy || undefined };
}

function Frame({
  id,
  label,
  labelAside,
  error,
  errorId,
  help,
  helpId,
  children,
}: FieldFrameProps & { id: string; errorId: string; helpId: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__label t-label">
        <label htmlFor={id}>{label}</label>
        {labelAside}
      </div>
      {children}
      {help ? (
        <span id={helpId} className="field__help t-meta">
          {help}
        </span>
      ) : null}
      {error ? (
        <p id={errorId} className="field__error t-meta" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = FieldFrameProps & InputHTMLAttributes<HTMLInputElement>;

/** Поле ввода панели: подпись, ошибка под полем (`aria-invalid`, `aria-describedby`). Совместимо с `register`. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, labelAside, error, help, className, ...input },
  ref,
) {
  const ids = useFieldIds(error, help);
  return (
    <Frame {...ids} label={label} labelAside={labelAside} error={error} help={help}>
      <input
        ref={ref}
        id={ids.id}
        className={`field__control t-body ${className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...input}
      />
    </Frame>
  );
});

export type TextAreaFieldProps = FieldFrameProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, labelAside, error, help, className, ...input }, ref) {
    const ids = useFieldIds(error, help);
    return (
      <Frame {...ids} label={label} labelAside={labelAside} error={error} help={help}>
        <textarea
          ref={ref}
          id={ids.id}
          className={`field__control t-body ${className ?? ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          {...input}
        />
      </Frame>
    );
  },
);

export type SelectFieldProps = FieldFrameProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
    /** `disabled` — вариант виден, но недоступен (причина — в подписи варианта или подсказке поля). */
    options: readonly { value: string; label: string; disabled?: boolean }[];
  };

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, labelAside, error, help, options, className, ...select },
  ref,
) {
  const ids = useFieldIds(error, help);
  // base-select (index.css) меряет закрытое поле по выбранному варианту — обёртка держит ширину самого длинного
  const sizer = options.reduce(
    (longest, option) => (option.label.length > longest.length ? option.label : longest),
    '',
  );
  return (
    <Frame {...ids} label={label} labelAside={labelAside} error={error} help={help}>
      {/* обёртка рисует шеврон: у <select> нет ::after, системная стрелка снята (appearance: none) */}
      <span className="field__select t-body" data-sizer={sizer}>
        <select
          ref={ref}
          id={ids.id}
          className={`field__control t-body ${className ?? ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          {...select}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    </Frame>
  );
});

export type CheckboxFieldProps = Omit<FieldFrameProps, 'labelAside'> &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Чекбокс панели (event-tickets PR C): нативный `input[type=checkbox]` внутри подписи — нажатие на текст переключает;
 * строка 36 px как у `.radio`. Ошибка и подсказка — под строкой. Совместимо с `register`.
 */
export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ label, error, help, className, ...input }, ref) {
    const ids = useFieldIds(error, help);
    return (
      <div className="field">
        <label className={`checkbox t-body ${className ?? ''}`} htmlFor={ids.id}>
          <input
            ref={ref}
            id={ids.id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={ids.describedBy}
            {...input}
          />
          <span>{label}</span>
        </label>
        {help ? (
          <span id={ids.helpId} className="field__help t-meta">
            {help}
          </span>
        ) : null}
        {error ? (
          <p id={ids.errorId} className="field__error t-meta" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
