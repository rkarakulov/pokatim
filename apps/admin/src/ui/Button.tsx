import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerSolid';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'button--primary',
  secondary: '',
  danger: 'button--danger',
  dangerSolid: 'button--danger-solid',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  full?: boolean;
  /** Запрос в процессе: кнопка неактивна (`aria-busy`), без скелетона (AGENTS.md §4.12). */
  busy?: boolean;
}

/** Кнопка панели (плотность 36 px, `.t-panel-button`). Кандидат в `admin-kit` (F6). */
export function Button({
  variant = 'secondary',
  size = 'md',
  full = false,
  busy = false,
  disabled,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'button',
    't-panel-button',
    VARIANT_CLASS[variant],
    size === 'sm' ? 'button--sm' : '',
    full ? 'button--full' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    />
  );
}
