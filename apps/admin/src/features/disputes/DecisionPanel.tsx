import {
  DISPUTE_NOTE_MAX,
  DISPUTE_OUTCOMES,
  DISPUTE_TEMPLATES_BY_OUTCOME,
  type DisputeDecisionTemplate,
  type DisputeOutcome,
  type PanelDispute,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useId, useState } from 'react';

import { Banner, Button, DisabledReason, Dialog, RadioGroup, TextAreaField } from '../../ui';
import { decideBlockText, decideErrorText } from './disputes-format';

const OUTCOME_CHOICES = DISPUTE_OUTCOMES.map((value) => ({
  value,
  label: t(`admin.disputes.decision.outcome.${value}`),
}));

/**
 * Решение по спору (`disputes.decide`, спор открыт): исход, шаблон причины для участников (из карты исхода,
 * обязателен), внутренняя заметка. До `decidableAt` (D-25) и при иных `decideBlockedBy` — кнопка `aria-disabled` с
 * причиной; решение окончательно — подтверждение в окне, ошибка сервера — в окне.
 */
export function DecisionPanel({
  dispute,
  onDecide,
}: {
  dispute: PanelDispute;
  onDecide: (body: {
    outcome: DisputeOutcome;
    template: DisputeDecisionTemplate;
    note?: string;
  }) => Promise<void>;
}) {
  const titleId = useId();
  const reasonId = useId();
  const [outcome, setOutcome] = useState<DisputeOutcome>();
  const [template, setTemplate] = useState<DisputeDecisionTemplate>();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const serverBlock = dispute.decideBlockedBy;
  const reason = serverBlock
    ? decideBlockText(serverBlock, dispute.decidableAt)
    : !outcome || !template
      ? t('admin.disputes.decision.chooseTemplate')
      : undefined;

  const close = () => {
    if (busy) return;
    setError(undefined);
    setConfirming(false);
  };
  const confirm = async () => {
    if (!outcome || !template || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const trimmed = note.trim();
      await onDecide({ outcome, template, ...(trimmed ? { note: trimmed } : {}) });
      setConfirming(false);
    } catch (failure) {
      setError(decideErrorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.disputes.decision.title')}
      </h2>
      <div className="form-column">
        <RadioGroup
          legend={t('admin.disputes.decision.outcome')}
          options={OUTCOME_CHOICES}
          value={outcome}
          onChange={(value) => {
            setOutcome(value);
            setTemplate(undefined);
          }}
        />
        {outcome === 'upheld' ? (
          <Banner>{t('admin.disputes.decision.upheldConsequence')}</Banner>
        ) : null}
        {outcome ? (
          <RadioGroup
            legend={t('admin.disputes.decision.template')}
            options={DISPUTE_TEMPLATES_BY_OUTCOME[outcome].map((value) => ({
              value,
              label: t(`admin.disputes.template.${value}`),
            }))}
            value={template}
            onChange={setTemplate}
          />
        ) : null}
        <TextAreaField
          label={t('admin.disputes.decision.note')}
          value={note}
          maxLength={DISPUTE_NOTE_MAX}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="form-actions">
          <Button
            variant="primary"
            aria-disabled={reason ? true : undefined}
            aria-describedby={reason ? reasonId : undefined}
            onClick={() => {
              if (!reason) setConfirming(true);
            }}
          >
            {t('admin.disputes.decision.submit')}
          </Button>
          {reason ? <DisabledReason id={reasonId}>{reason}</DisabledReason> : null}
        </div>
      </div>
      <Dialog open={confirming} title={t('admin.disputes.decision.confirmTitle')} onClose={close}>
        <p className="dialog__consequences t-body">
          {outcome === 'upheld'
            ? t('admin.disputes.decision.confirmUpheld')
            : t('admin.disputes.decision.confirmRejected')}
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
            variant={outcome === 'upheld' ? 'dangerSolid' : 'primary'}
            busy={busy}
            onClick={() => void confirm()}
          >
            {t('admin.disputes.decision.submit')}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
