import { t } from '@pokatim/i18n';

import { Banner } from './Banner';
import { Button } from './Button';

/**
 * 409 `CONFLICT` правки по устаревшей версии: «Запись изменили — обновите страницу» с действием «Обновить»
 * (перечитать запись и сбросить форму — решает экран). Свой текст раздела — `title` и `message` (routes-06: «Заявку
 * уже изменили — обновите страницу»).
 */
export function ConflictBanner({
  onReload,
  busy = false,
  title = t('admin.conflict.title'),
  message = t('admin.conflict.message'),
}: {
  onReload: () => void;
  busy?: boolean;
  title?: string;
  message?: string;
}) {
  return (
    <Banner
      tone="warning"
      role="alert"
      title={title}
      actions={
        <Button size="sm" busy={busy} onClick={onReload}>
          {t('admin.conflict.reload')}
        </Button>
      }
    >
      {message}
    </Banner>
  );
}
