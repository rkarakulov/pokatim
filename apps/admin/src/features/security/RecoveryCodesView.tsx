import { t } from '@pokatim/i18n';
import { useId, useState } from 'react';

import { Banner, Button } from '../../ui';
import { copyText, type CopyState } from './clipboard';

/** Скачивание `.txt` из памяти: ссылка на `Blob` (без `data:` и запросов), ссылка отзывается сразу. */
function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Коды восстановления — показываются один раз (D3): список, «Скопировать», «Скачать .txt»; продолжить можно только
 * после «Я сохранил коды».
 */
export function RecoveryCodesView({
  codes,
  email,
  continueLabel,
  onContinue,
}: {
  codes: readonly string[];
  /** Подпись в файле — чей набор (без него файл неотличим от набора другого сотрудника). */
  email: string;
  continueLabel: string;
  onContinue: () => void;
}) {
  const listId = useId();
  const [saved, setSaved] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const text = codes.join('\n');

  return (
    <div className="recovery-codes">
      <p className="t-body">{t('admin.totp.codesLead')}</p>
      <ol
        id={listId}
        className="recovery-codes__list t-body"
        aria-label={t('admin.totp.codesList')}
      >
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="recovery-codes__tools">
        <Button
          size="sm"
          aria-describedby={listId}
          onClick={() => {
            void copyText(text).then((ok) => setCopy(ok ? 'copied' : 'failed'));
          }}
        >
          {t('admin.totp.codesCopy')}
        </Button>
        <Button
          size="sm"
          onClick={() =>
            downloadText(
              'pokatim-protocol-recovery-codes.txt',
              `${t('admin.totp.codesFile', { email })}\n\n${text}\n`,
            )
          }
        >
          {t('admin.totp.codesDownload')}
        </Button>
      </div>
      {copy === 'copied' ? <Banner>{t('admin.totp.copied')}</Banner> : null}
      {copy === 'failed' ? (
        <Banner tone="error" role="alert">
          {t('admin.totp.codesCopyFailed')}
        </Banner>
      ) : null}
      <label className="checkbox checkbox--spaced t-body">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        {t('admin.totp.codesSaved')}
      </label>
      <div className="auth__actions">
        <Button variant="primary" full disabled={!saved} onClick={onContinue}>
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
