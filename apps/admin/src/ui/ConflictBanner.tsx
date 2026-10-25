import { t } from '@pokatim/i18n';

import { Banner } from './Banner';
import { Button } from './Button';

/**
 * 409 `CONFLICT` правки по устаревшей версии: «Запись изменили — обновите страницу» с действием «Обновить»
 * (перечитать запись и сбросить форму — решает экран).
 */
export function ConflictBanner({
  onReload,
  busy = false,
}: {
  onReload: () => void;
  busy?: boolean;
}) {
  return (
    <Banner
      tone="warning"
      role="alert"
      title={t('admin.conflict.title')}
      actions={
        <Button size="sm" busy={busy} onClick={onReload}>
          {t('admin.conflict.reload')}
        </Button>
      }
    >
      {t('admin.conflict.message')}
    </Banner>
  );
}
