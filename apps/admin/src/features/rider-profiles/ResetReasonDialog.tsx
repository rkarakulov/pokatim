import {
  ACTION_REASON_MAX_LENGTH,
  ACTION_REASON_MIN_LENGTH,
  PROFILE_REPORT_REASONS,
  type ProfileReportReason,
  type RiderProfileResetRequest,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useState } from 'react';

import { Banner, Button, Dialog, RadioGroup, TextAreaField } from '../../ui';

/** Варианты причины — справочник причин жалоб на профиль, подписи — как у жалоб (`domain.profileReportReason.*`). */
const REASON_OPTIONS = PROFILE_REPORT_REASONS.map((value) => ({
  value,
  label: t(`domain.profileReportReason.${value}`),
}));

export interface ResetReasonDialogProps {
  open: boolean;
  title: string;
  /** Что произойдёт (показывается до причины). */
  consequences: string;
  confirmLabel: string;
  /** Ошибка запроса — текст в окне; окно остаётся открытым. */
  errorText: (error: unknown) => string;
  onConfirm: (body: RiderProfileResetRequest) => Promise<void>;
  onClose: () => void;
}

/**
 * Сброс имени, фото или клуба модератором (profile-moderation-d11, D11-1): причина — из справочника причин жалоб на
 * профиль (радио), текст — только у «Другое» (обязателен, 3–500, уходит в append-only журнал) — с предупреждением не
 * повторять имя и клуб. Подтверждение неактивно до выбора причины и, у «Другое», до достаточного текста. Esc и
 * «Отмена» закрывают (не во время запроса) и сбрасывают выбор; ошибка сервера — в окне. Выбор «Другое» — фокус в поле
 * текста. Как `ReasonDialog`, но тело — `{ reason, comment? }`.
 */
export function ResetReasonDialog({
  open,
  title,
  consequences,
  confirmLabel,
  errorText,
  onConfirm,
  onClose,
}: ResetReasonDialogProps) {
  const [reason, setReason] = useState<ProfileReportReason>();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const other = reason === 'other';
  const ready =
    reason !== undefined && (!other || comment.trim().length >= ACTION_REASON_MIN_LENGTH);

  const reset = () => {
    setReason(undefined);
    setComment('');
    setError(undefined);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const confirm = async () => {
    if (reason === undefined || !ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(other ? { reason, comment: comment.trim() } : { reason });
      reset();
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
        legend={t('admin.riderProfiles.resetReason')}
        options={REASON_OPTIONS}
        value={reason}
        onChange={setReason}
        autoFocusFirst
      />
      {other ? (
        <>
          <Banner tone="warning">{t('admin.riderProfiles.reasonWarning')}</Banner>
          <TextAreaField
            label={t('admin.dialog.reason')}
            value={comment}
            // выбор «Другое» — сразу к тексту (поле появляется только тогда)
            autoFocus
            maxLength={ACTION_REASON_MAX_LENGTH}
            onChange={(event) => setComment(event.target.value)}
          />
        </>
      ) : null}
      {error ? (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      ) : null}
      <div className="dialog__actions">
        <Button onClick={close} disabled={busy}>
          {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
        </Button>
        <Button variant="dangerSolid" disabled={!ready} busy={busy} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
