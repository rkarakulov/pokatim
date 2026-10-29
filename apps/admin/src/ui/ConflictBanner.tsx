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

/**
 * Перечитывание не удалось, а данные уже на экране (AGENTS.md §4.12): «Не удалось обновить данные» поверх последних
 * загруженных с «Повторить». Свой заголовок раздела — `title`.
 */
export function RefreshFailedBanner({
  onRetry,
  busy = false,
  title = t('admin.refreshFailed'),
}: {
  onRetry: () => void;
  busy?: boolean;
  title?: string;
}) {
  return (
    <Banner
      tone="error"
      role="alert"
      title={title}
      actions={
        <Button size="sm" busy={busy} onClick={onRetry}>
          {t('state.retry')}
        </Button>
      }
    >
      {t('admin.refreshFailedMessage')}
    </Banner>
  );
}
