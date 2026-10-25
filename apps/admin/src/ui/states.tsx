import { isNetworkError } from '@pokatim/api-client';
import { t } from '@pokatim/i18n';
import type { ReactNode } from 'react';

import { Button } from './Button';

/** Пустое состояние экрана или блока. */
export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="state">
      <p className="t-title-sm">{title}</p>
      {children ? <div className="muted t-meta">{children}</div> : null}
    </div>
  );
}

/**
 * Ошибка без данных (AGENTS.md §4.12): сетевая — «Нет соединения», ответ сервера — «Не удалось загрузить»; всегда с
 * повтором.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = isNetworkError(error);
  return (
    <div className="state" role="alert">
      <p className="t-title-sm">{t(offline ? 'state.errorTitle' : 'state.failedTitle')}</p>
      <p className="muted t-meta">{t(offline ? 'state.errorMessage' : 'state.failedMessage')}</p>
      <div className="state__actions">
        <Button onClick={onRetry}>{t('state.retry')}</Button>
      </div>
    </div>
  );
}
