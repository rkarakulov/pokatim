import { t } from '@pokatim/i18n';
import { useState } from 'react';

import { Banner } from './Banner';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { RadioGroup } from './RadioGroup';

export interface ChoiceDialogProps<T extends string> {
  open: boolean;
  title: string;
  /** Что произойдёт (строка последствий под заголовком). */
  consequences: string;
  /** Подпись группы вариантов. */
  choicesLabel: string;
  choices: readonly { value: T; label: string }[];
  /** Превью выбранного варианта («Участники увидят …»); `undefined` — ещё не выбран. */
  preview: (value: T | undefined) => string;
  confirmLabel: string;
  /** Разрушительное действие — заливка error, не по умолчанию для Enter. */
  destructive?: boolean;
  /** Ошибка запроса — текст в окне; окно остаётся открытым. */
  errorText?: (error: unknown) => string;
  onConfirm: (value: T) => Promise<void>;
  onClose: () => void;
}

/**
 * Подтверждение с выбором причины из списка (шаблоны без свободного текста): фокус при открытии — на первом
 * варианте, подтверждение неактивно до выбора, превью выбранного; Esc и «Отмена» закрывают, фокус возвращается на
 * элемент, открывший окно (`Dialog`).
 */
export function ChoiceDialog<T extends string>({
  open,
  title,
  consequences,
  choicesLabel,
  choices,
  preview,
  confirmLabel,
  destructive = false,
  errorText = () => t('error.unknown'),
  onConfirm,
  onClose,
}: ChoiceDialogProps<T>) {
  const [choice, setChoice] = useState<T>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const close = () => {
    if (busy) return;
    setChoice(undefined);
    setError(undefined);
    onClose();
  };

  const confirm = async () => {
    if (!choice || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(choice);
      setChoice(undefined);
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
      <RadioGroup
        legend={choicesLabel}
        options={choices}
        value={choice}
        onChange={setChoice}
        autoFocusFirst
      />
      <p className="dialog__preview t-body" aria-live="polite">
        {preview(choice)}
      </p>
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
          disabled={!choice}
          busy={busy}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
