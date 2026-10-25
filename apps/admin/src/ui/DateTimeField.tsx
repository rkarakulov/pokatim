import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { TextField } from './fields';

export interface ZonedFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
  label: ReactNode;
  /** Пояс у подписи («Europe/Minsk»): значение — настенное время этого пояса, не браузера. */
  zoneLabel: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  help?: ReactNode;
  /** Поле зафиксировано сервером: значение читается, ввод недоступен, замок у подписи. */
  lockedLabel?: string;
}

function ZoneLabel({
  label,
  zoneLabel,
  lockedLabel,
}: Pick<ZonedFieldProps, 'label' | 'zoneLabel' | 'lockedLabel'>) {
  return (
    <>
      {label}
      <span className="field__zone t-meta-xs">{zoneLabel}</span>
      {lockedLabel ? <LockMark label={lockedLabel} /> : null}
    </>
  );
}

/** Замок у подписи зафиксированного поля (иконка — CSS-маска, текст — для чтения с экрана). */
export function LockMark({ label }: { label: string }) {
  return (
    <span className="lock-mark t-meta-xs">
      <span className="lock-mark__icon" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Дата и время по поясу платформы: нативный `<input type="datetime-local">`, значение — строка настенного времени
 * `YYYY-MM-DDTHH:mm` (пояс браузера не участвует). В запрос — `minskWallTimeToUtc` контрактов, не `new Date(value)`.
 */
export const DateTimeField = forwardRef<HTMLInputElement, ZonedFieldProps>(function DateTimeField(
  { label, zoneLabel, lockedLabel, value, onChange, ...input },
  ref,
) {
  return (
    <TextField
      ref={ref}
      {...input}
      type="datetime-local"
      step={60}
      label={<ZoneLabel label={label} zoneLabel={zoneLabel} lockedLabel={lockedLabel} />}
      value={value}
      className={lockedLabel ? 'field__control--locked' : input.className}
      disabled={input.disabled || Boolean(lockedLabel)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
});

/** Календарная дата по поясу платформы (`YYYY-MM-DD`, `<input type="date">`). */
export const DateField = forwardRef<HTMLInputElement, ZonedFieldProps>(function DateField(
  { label, zoneLabel, lockedLabel, value, onChange, ...input },
  ref,
) {
  return (
    <TextField
      ref={ref}
      {...input}
      type="date"
      label={<ZoneLabel label={label} zoneLabel={zoneLabel} lockedLabel={lockedLabel} />}
      value={value}
      className={lockedLabel ? 'field__control--locked' : input.className}
      disabled={input.disabled || Boolean(lockedLabel)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
});
