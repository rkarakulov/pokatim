import type { PanelMe, TotpSetup } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../../api';
import { RecoveryCodesView } from '../security/RecoveryCodesView';
import { errorCodeOf, totpErrorText } from '../security/totp-errors';
import { TotpCodeForm, type TotpCodeInput } from '../security/TotpCodeForm';
import { TotpEnrollment } from '../security/TotpEnrollment';
import { AuthCard, Banner, Button } from '../../ui';

interface StepProps {
  challenge: string;
  /** Вход завершён: cookie выставлена, `me` — в кэш и на исходную страницу. */
  onSignedIn: (me: PanelMe) => Promise<void> | void;
  /** Вызов истёк, исчерпан или штамп сменился — обратно к паролю с сообщением. */
  onExpired: () => void;
  onBack: () => void;
}

/** «Запомнить это устройство на 30 дней» (D4): пропускает только шаг кода. */
function RememberDevice({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox checkbox--spaced t-body">
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      {t('admin.totp.remember')}
    </label>
  );
}

const isExpired = (error: unknown) => errorCodeOf(error) === 'TOTP_CHALLENGE_EXPIRED';

/** Второй шаг входа (`totpRequired`): код из приложения или код восстановления. */
export function TotpStep({ challenge, onSignedIn, onExpired, onBack }: StepProps) {
  const [remember, setRemember] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const verify = useMutation({
    mutationFn: (input: TotpCodeInput) =>
      api.signInTotp({ challenge, ...input, rememberDevice: remember }),
    meta: { ownsUnauthorized: true },
    onSuccess: (result) => onSignedIn(result.me),
    onError: (error) => {
      if (isExpired(error)) onExpired();
    },
  });
  return (
    <AuthCard title={t('admin.totp.signInTitle')}>
      <p className="auth__lead t-body">
        {t(recoveryMode ? 'admin.totp.signInRecoveryLead' : 'admin.totp.signInLead')}
      </p>
      <TotpCodeForm
        allowRecovery
        submitLabel={t('admin.totp.verify')}
        busy={verify.isPending}
        error={verify.isError && !isExpired(verify.error) ? totpErrorText(verify.error) : undefined}
        extra={<RememberDevice value={remember} onChange={setRemember} />}
        actions={
          // пока код проверяется, «Назад» неактивна: поздний вход иначе вмешался бы в форму пароля
          <Button full disabled={verify.isPending} onClick={onBack}>
            {t('admin.totp.back')}
          </Button>
        }
        onSubmit={(input) => verify.mutate(input)}
        onModeChange={setRecoveryMode}
      />
    </AuthCard>
  );
}

type SetupView =
  | { kind: 'intro' }
  | { kind: 'enroll'; setup: TotpSetup }
  | { kind: 'codes'; codes: string[]; me: PanelMe };

/**
 * Подключение 2FA на экране входа (`totpSetupRequired`, D2): вступление → QR и первый код → коды восстановления
 * («Я сохранил коды») → вход. Сессия выставлена уже при подтверждении, панель открывается после кодов.
 */
export function TotpSetupStep({ challenge, onSignedIn, onExpired, onBack }: StepProps) {
  const [view, setView] = useState<SetupView>({ kind: 'intro' });
  const [remember, setRemember] = useState(false);
  const handleError = (error: unknown) => {
    if (isExpired(error)) onExpired();
  };
  const start = useMutation({
    mutationFn: () => api.signInTotpSetup(challenge),
    meta: { ownsUnauthorized: true },
    onSuccess: (setup) => setView({ kind: 'enroll', setup }),
    onError: handleError,
  });
  const confirm = useMutation({
    mutationFn: (code: string) =>
      api.signInTotpSetupConfirm({ challenge, code, rememberDevice: remember }),
    meta: { ownsUnauthorized: true },
    onSuccess: (result) => setView({ kind: 'codes', codes: result.recoveryCodes, me: result.me }),
    onError: handleError,
  });
  // пока идёт запрос секрета или подтверждение, «Назад» неактивна: коды восстановления из ответа иначе потерялись бы
  const back = (
    <Button full disabled={start.isPending || confirm.isPending} onClick={onBack}>
      {t('admin.totp.back')}
    </Button>
  );

  if (view.kind === 'codes') {
    return (
      <AuthCard title={t('admin.totp.codesTitle')}>
        <RecoveryCodesView
          codes={view.codes}
          email={view.me.user.email}
          continueLabel={t('admin.totp.codesContinue')}
          onContinue={() => void onSignedIn(view.me)}
        />
      </AuthCard>
    );
  }
  if (view.kind === 'enroll') {
    return (
      <AuthCard title={t('admin.totp.enrollTitle')}>
        <TotpEnrollment
          setup={view.setup}
          busy={confirm.isPending}
          error={
            confirm.isError && !isExpired(confirm.error) ? totpErrorText(confirm.error) : undefined
          }
          extra={<RememberDevice value={remember} onChange={setRemember} />}
          actions={back}
          onConfirm={(code) => confirm.mutate(code)}
        />
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('admin.totp.setupRequiredTitle')}>
      <p className="auth__lead t-body">{t('admin.totp.setupRequiredLead')}</p>
      {start.isError && !isExpired(start.error) ? (
        <Banner tone="error" role="alert">
          {totpErrorText(start.error)}
        </Banner>
      ) : null}
      <div className="auth__actions">
        <Button variant="primary" full busy={start.isPending} onClick={() => start.mutate()}>
          {t('admin.totp.setupStart')}
        </Button>
        {back}
      </div>
    </AuthCard>
  );
}
