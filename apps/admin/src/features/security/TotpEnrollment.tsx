import type { TotpSetup } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { type ReactNode, useState } from 'react';

import { Button, QrCode } from '../../ui';
import { groupSecret } from './code-input';
import { TotpCodeForm } from './TotpCodeForm';

/**
 * Подключение 2FA (общий шаг входа и «Безопасности», D2/D9): QR из `otpauth://`, ключ для ручного ввода группами по 4
 * с копированием, поле первого кода. Секрет живёт только в памяти этого экрана.
 */
export function TotpEnrollment({
  setup,
  busy,
  error,
  extra,
  actions,
  onConfirm,
}: {
  setup: TotpSetup;
  busy: boolean;
  error?: string;
  extra?: ReactNode;
  actions?: ReactNode;
  onConfirm: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="totp-enroll">
      <ol className="totp-enroll__steps t-body">
        <li>
          {t('admin.totp.enrollStep1')}
          <QrCode value={setup.otpauthUri} label={t('admin.totp.qrLabel')} />
        </li>
        <li>
          {t('admin.totp.enrollStep2')}
          <span className="totp-enroll__secret">
            <code>{groupSecret(setup.secret)}</code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(setup.secret).then(() => setCopied(true));
              }}
            >
              {copied ? t('admin.totp.copied') : t('admin.totp.copy')}
            </Button>
          </span>
        </li>
        <li>{t('admin.totp.enrollStep3')}</li>
      </ol>
      <TotpCodeForm
        submitLabel={t('admin.totp.enrollSubmit')}
        busy={busy}
        error={error}
        extra={extra}
        actions={actions}
        onSubmit={(input) => {
          if ('code' in input) onConfirm(input.code);
        }}
      />
    </div>
  );
}
