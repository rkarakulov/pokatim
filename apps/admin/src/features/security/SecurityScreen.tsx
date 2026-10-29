import type { TotpSetup, TotpStatus } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { api } from '../../api';
import { formatDateTime } from '../../format';
import { ME_QUERY_KEY, useMe } from '../../session/me';
import { Button, Dialog, DisabledReason, ErrorState, PageHeader } from '../../ui';
import { RecoveryCodesView } from './RecoveryCodesView';
import { totpErrorText } from './totp-errors';
import { TotpCodeForm, type TotpCodeInput } from './TotpCodeForm';
import { TotpEnrollment } from './TotpEnrollment';

export const TOTP_STATUS_QUERY_KEY = ['admin', 'account', 'totp'] as const;

const totpStatusQuery = queryOptions({
  queryKey: TOTP_STATUS_QUERY_KEY,
  queryFn: () => api.getTotpStatus(),
});

/** Меньше стольких непогашенных кодов — подсказка перевыпустить набор. */
const CODES_LOW = 3;

type Flow =
  | { kind: 'idle' }
  | { kind: 'enroll'; setup: TotpSetup }
  | { kind: 'regenerate' }
  | { kind: 'disable' }
  | { kind: 'codes'; codes: string[] };

/**
 * «Безопасность» (`/account/security`, любая роль, D9): статус 2FA своего аккаунта, подключение (QR → код → коды
 * восстановления), перевыпуск кодов (с кодом TOTP), отключение (с кодом TOTP или восстановления). При обязательности
 * (admin, `PANEL_TOTP_ENFORCED`) отключение недоступно с пояснением — источник истины сервер (`409 TOTP_REQUIRED`).
 */
export function SecurityScreen() {
  const me = useMe();
  const queryClient = useQueryClient();
  const status = useQuery(totpStatusQuery);
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' });
  const requiredId = useId();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: TOTP_STATUS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    ]);

  const start = useMutation({
    mutationFn: () => api.startTotpSetup(),
    onSuccess: (setup) => setFlow({ kind: 'enroll', setup }),
  });
  const confirm = useMutation({
    mutationFn: (code: string) => api.confirmTotpSetup({ code }),
    onSuccess: async (result) => {
      setFlow({ kind: 'codes', codes: result.recoveryCodes });
      await refresh();
    },
  });
  const regenerate = useMutation({
    mutationFn: (code: string) => api.regenerateRecoveryCodes({ code }),
    onSuccess: async (result) => {
      setFlow({ kind: 'codes', codes: result.recoveryCodes });
      await refresh();
    },
  });
  const disable = useMutation({
    mutationFn: (input: TotpCodeInput) => api.disableTotp(input),
    onSuccess: async () => {
      setFlow({ kind: 'idle' });
      await refresh();
    },
  });

  const close = () => {
    for (const mutation of [start, confirm, regenerate, disable]) mutation.reset();
    setFlow({ kind: 'idle' });
  };

  return (
    <>
      <PageHeader title={t('admin.security.title')} />
      <div className="page-body">
        <section className="section" aria-labelledby="totp-title">
          <h2 id="totp-title" className="section__title t-label">
            {t('admin.security.totpTitle')}
          </h2>
          {status.isError ? (
            <ErrorState error={status.error} onRetry={() => void status.refetch()} />
          ) : !status.data ? (
            <div role="progressbar" aria-label={t('state.loading')}>
              <p className="skeleton t-body"> </p>
            </div>
          ) : flow.kind === 'codes' ? (
            <RecoveryCodesView
              codes={flow.codes}
              email={me?.user.email ?? ''}
              continueLabel={t('admin.security.done')}
              onContinue={close}
            />
          ) : flow.kind === 'enroll' ? (
            <div className="security__enroll">
              <TotpEnrollment
                setup={flow.setup}
                busy={confirm.isPending}
                error={confirm.isError ? totpErrorText(confirm.error) : undefined}
                actions={
                  <Button full onClick={close}>
                    {t('admin.security.cancel')}
                  </Button>
                }
                onConfirm={(code) => confirm.mutate(code)}
              />
            </div>
          ) : (
            <StatusBlock
              status={status.data}
              requiredId={requiredId}
              starting={start.isPending}
              startError={start.isError ? totpErrorText(start.error) : undefined}
              onEnable={() => start.mutate()}
              onRegenerate={() => setFlow({ kind: 'regenerate' })}
              onDisable={() => setFlow({ kind: 'disable' })}
            />
          )}
        </section>
      </div>

      <Dialog
        open={flow.kind === 'regenerate'}
        title={t('admin.security.regenerateTitle')}
        onClose={close}
      >
        <p className="dialog__consequences t-body">{t('admin.security.regenerateLead')}</p>
        <TotpCodeForm
          submitLabel={t('admin.security.regenerate')}
          busy={regenerate.isPending}
          error={regenerate.isError ? totpErrorText(regenerate.error) : undefined}
          actions={<Button onClick={close}>{t('admin.security.cancel')}</Button>}
          onSubmit={(input) => {
            if ('code' in input) regenerate.mutate(input.code);
          }}
        />
      </Dialog>
      <Dialog
        open={flow.kind === 'disable'}
        title={t('admin.security.disableTitle')}
        onClose={close}
      >
        <p className="dialog__consequences t-body">{t('admin.security.disableLead')}</p>
        <TotpCodeForm
          allowRecovery
          submitLabel={t('admin.security.disable')}
          busy={disable.isPending}
          error={disable.isError ? totpErrorText(disable.error) : undefined}
          actions={<Button onClick={close}>{t('admin.security.cancel')}</Button>}
          onSubmit={(input) => disable.mutate(input)}
        />
      </Dialog>
    </>
  );
}

function StatusBlock({
  status,
  requiredId,
  starting,
  startError,
  onEnable,
  onRegenerate,
  onDisable,
}: {
  status: TotpStatus;
  requiredId: string;
  starting: boolean;
  startError?: string;
  onEnable: () => void;
  onRegenerate: () => void;
  onDisable: () => void;
}) {
  if (!status.enabled) {
    return (
      <>
        <p className="t-body">{t('admin.security.disabled')}</p>
        <p className="muted t-meta">{t('admin.security.recommend')}</p>
        {startError ? (
          <p className="field__error t-meta" role="alert">
            {startError}
          </p>
        ) : null}
        <div className="security__actions">
          <Button variant="primary" busy={starting} onClick={onEnable}>
            {t('admin.security.enable')}
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="t-body">
        {t('admin.security.enabled', {
          date: status.enabledAt ? formatDateTime(status.enabledAt) : '',
        })}
      </p>
      <p className="muted t-meta">
        {t('admin.security.codesLeft', { count: status.recoveryCodesLeft })}
        {status.recoveryCodesLeft < CODES_LOW ? ` ${t('admin.security.codesLow')}` : ''}
      </p>
      <div className="security__actions">
        <Button onClick={onRegenerate}>{t('admin.security.regenerate')}</Button>
        <Button
          variant="danger"
          aria-disabled={status.required || undefined}
          aria-describedby={status.required ? requiredId : undefined}
          onClick={() => {
            if (!status.required) onDisable();
          }}
        >
          {t('admin.security.disable')}
        </Button>
      </div>
      {status.required ? (
        <DisabledReason id={requiredId}>{t('admin.security.requiredReason')}</DisabledReason>
      ) : null}
    </>
  );
}
