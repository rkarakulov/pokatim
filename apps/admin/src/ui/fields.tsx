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
    options: readonly { value: string; label: string }[];
  };

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, labelAside, error, help, options, className, ...select },
  ref,
) {
  const ids = useFieldIds(error, help);
  return (
    <Frame {...ids} label={label} labelAside={labelAside} error={error} help={help}>
      <select
        ref={ref}
        id={ids.id}
        className={`field__control t-body ${className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Frame>
  );
});
