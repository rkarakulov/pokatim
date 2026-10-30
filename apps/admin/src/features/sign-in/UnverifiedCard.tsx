import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { type PanelSignInResponse, RateLimitedDetails } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api';
import { AuthCard, Banner, Button } from '../../ui';

type Pending = Extract<PanelSignInResponse, { state: 'verificationRequired' }>;

/** Состояние карточки «E-mail не подтверждён»: адрес, токен регистрации, момент следующего повтора (мс). */
export interface UnverifiedState {
  email: string;
  registrationToken: string;
  resendAt: number;
}

/** Ответ `verificationRequired` (вход, принятие приглашения) → состояние карточки. */
export function unverifiedState(
  result: Pending,
  enteredEmail: string,
  at: number,
): UnverifiedState {
  return {
    email: result.email || enteredEmail.trim(),
    registrationToken: result.registrationToken,
    resendAt: at + result.resendAvailableInSec * 1000,
  };
}

/** «E-mail не подтверждён» (вход и принятие приглашения): повтор письма (лимиты identity), пауза — с отсчётом. */
export function UnverifiedCard({
  view,
  now,
  onResent,
  onBack,
}: {
  view: UnverifiedState;
  now: number;
  /** Пауза до следующего повтора, секунды. */
  onResent: (seconds: number) => void;
  onBack: () => void;
}) {
  const [sent, setSent] = useState(false);
  const resend = useMutation({
    mutationFn: () => api.resendVerification({ registrationToken: view.registrationToken }),
    meta: { ownsUnauthorized: true },
    onSuccess: (result) => {
      if ('state' in result) {
        onBack();
        return;
      }
      setSent(true);
      onResent(result.resendAvailableInSec);
    },
    onError: (error) => {
      const details = RateLimitedDetails.safeParse(apiErrorOf(error)?.details);
      if (details.success) onResent(details.data.retryAfterSec);
    },
  });
  const waitSec = Math.max(0, Math.ceil((view.resendAt - now) / 1000));
  return (
    <AuthCard title={t('admin.signIn.unverifiedTitle')}>
      <p className="auth__lead t-body">{t('admin.signIn.unverifiedMessage')}</p>
      {sent ? <Banner>{t('admin.signIn.resent')}</Banner> : null}
      {resend.isError &&
      !RateLimitedDetails.safeParse(apiErrorOf(resend.error)?.details).success ? (
        <Banner tone="error" role="alert">
          {t(isNetworkError(resend.error) ? 'error.network' : 'error.unknown')}
        </Banner>
      ) : null}
      <div className="auth__actions">
        <Button
          variant="primary"
          full
          disabled={waitSec > 0}
          busy={resend.isPending}
          aria-describedby={waitSec > 0 ? 'resend-wait' : undefined}
          onClick={() => resend.mutate()}
        >
          {t('admin.signIn.resend')}
        </Button>
        {waitSec > 0 ? (
          <p id="resend-wait" className="muted t-meta">
            {t('admin.signIn.resendIn', { seconds: waitSec })}
          </p>
        ) : null}
        <Button full onClick={onBack}>
          {t('admin.signIn.back')}
        </Button>
      </div>
    </AuthCard>
  );
}
