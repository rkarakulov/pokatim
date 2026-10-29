import { t } from '@pokatim/i18n';
import { type ReactNode, useState } from 'react';

import { Banner, Button, TextField } from '../../ui';
import { recoveryCodeOf, totpCodeOf } from './code-input';

export type TotpCodeInput = { code: string } | { recoveryCode: string };

/**
 * Поле второго фактора: код из приложения (6 цифр, `one-time-code`, цифровая клавиатура; пробелы убираются) или — с
 * `allowRecovery` — код восстановления (переключатель). Формат проверяется до отправки (ошибка под полем), ошибка
 * сервера — баннер `role="alert"`. Фокус — на поле при появлении и смене режима.
 */
export function TotpCodeForm({
  allowRecovery = false,
  submitLabel,
  busy = false,
  error,
  disabled = false,
  extra,
  actions,
  onSubmit,
  onModeChange,
}: {
  allowRecovery?: boolean;
  submitLabel: string;
  busy?: boolean;
  /** Ошибка сервера (текст). */
  error?: string;
  disabled?: boolean;
  /** Поля под кодом (например, «Запомнить устройство»). */
  extra?: ReactNode;
  /** Кнопки рядом с отправкой («Назад», «Отмена»). */
  actions?: ReactNode;
  onSubmit: (input: TotpCodeInput) => void;
  /** Смена режима поля (подсказка над формой следует за ним). */
  onModeChange?: (recovery: boolean) => void;
}) {
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [formatError, setFormatError] = useState<string>();

  const submit = () => {
    if (recovery) {
      const recoveryCode = recoveryCodeOf(value);
      if (!recoveryCode) return setFormatError(t('admin.totp.recoveryFormat'));
      setFormatError(undefined);
      onSubmit({ recoveryCode });
      return;
    }
    const code = totpCodeOf(value);
    if (!code) return setFormatError(t('admin.totp.codeFormat'));
    setFormatError(undefined);
    onSubmit({ code });
  };

  const switchMode = () => {
    setRecovery(!recovery);
    onModeChange?.(!recovery);
    setValue('');
    setFormatError(undefined);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error ? (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      ) : null}
      <TextField
        key={recovery ? 'recovery' : 'code'}
        label={t(recovery ? 'admin.totp.recoveryLabel' : 'admin.totp.codeLabel')}
        help={t(recovery ? 'admin.totp.recoveryHelp' : 'admin.totp.codeHelp')}
        autoComplete={recovery ? 'off' : 'one-time-code'}
        inputMode={recovery ? 'text' : 'numeric'}
        autoCapitalize="off"
        spellCheck={false}
        // поле появляется по действию пользователя (шаг входа, окно) — фокус сразу на нём
        autoFocus
        disabled={disabled}
        value={value}
        error={formatError}
        onChange={(event) => setValue(event.target.value)}
      />
      {allowRecovery ? (
        <button type="button" className="link-button link t-meta totp__switch" onClick={switchMode}>
          {t(recovery ? 'admin.totp.useCode' : 'admin.totp.useRecovery')}
        </button>
      ) : null}
      {extra}
      <div className="auth__actions">
        <Button
          type="submit"
          variant="primary"
          full
          disabled={disabled || value.trim() === ''}
          busy={busy}
        >
          {submitLabel}
        </Button>
        {actions}
      </div>
    </form>
  );
}
