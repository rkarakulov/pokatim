import { ACTION_REASON_MAX_LENGTH, ACTION_REASON_MIN_LENGTH } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { type ReactNode, useState } from 'react';

import { Banner } from './Banner';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { TextAreaField } from './fields';

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  /** Что произойдёт (показывается до причины). */
  consequences: string;
  confirmLabel: string;
  /** Разрушительное действие — красная кнопка подтверждения (не по умолчанию для Enter). */
  destructive?: boolean;
  /** Поля над причиной (например, новая роль). */
  extraFields?: ReactNode;
  /** Ошибка запроса — текст в окне; окно остаётся открытым. */
  errorText?: (error: unknown) => string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Подтверждение чувствительного действия с обязательной причиной (уходит в append-only журнал): подтверждение
 * неактивно, пока причина короче минимума; Esc и «Отмена» закрывают; ошибка сервера — в окне.
 */
export function ReasonDialog({
  open,
  title,
  consequences,
  confirmLabel,
  destructive = false,
  extraFields,
  errorText = () => t('error.unknown'),
  onConfirm,
  onClose,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = reason.trim().length >= ACTION_REASON_MIN_LENGTH;

  const close = () => {
    if (busy) return;
    setReason('');
    setError(undefined);
    onClose();
  };

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={title} onClose={close}>
      <p className="dialog__consequences t-body">{consequences}</p>
      {extraFields}
      <TextAreaField
        label={t('admin.dialog.reason')}
        value={reason}
        maxLength={ACTION_REASON_MAX_LENGTH}
        onChange={(event) => setReason(event.target.value)}
      />
      {error ? (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      ) : null}
      <div className="dialog__actions">
        <Button onClick={close} disabled={busy}>
          {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
        </Button>
        <Button
          variant={destructive ? 'dangerSolid' : 'primary'}
          disabled={!ready}
          busy={busy}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
