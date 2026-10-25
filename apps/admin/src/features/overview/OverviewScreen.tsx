import { isNetworkError } from '@pokatim/api-client';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api';
import { Button, EmptyState, PageHeader } from '../../ui';

/** Статус API (прежняя заглушка панели): загрузка — скелетон, ошибка — с повтором (AGENTS.md §4.12). */
function ApiStatus() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const retry = () => void health.refetch();
  return (
    <section className="api-status" aria-busy={health.isPending}>
      <span className="t-meta muted">{t('admin.apiStatus')}</span>
      {health.data !== undefined ? (
        <span className="t-meta">
          {t(health.data.status === 'ok' ? 'apiStatus.ok' : 'apiStatus.degraded')}
        </span>
      ) : health.isPending ? (
        <span
          className="skeleton t-meta api-status__value"
          role="progressbar"
          aria-label={t('state.loading')}
        >
          {' '}
        </span>
      ) : (
        <span role="alert" className="api-status">
          <span className="t-meta">
            {t(isNetworkError(health.error) ? 'state.errorMessage' : 'state.failedMessage')}
          </span>
          <Button size="sm" onClick={retry}>
            {t('state.retry')}
          </Button>
        </span>
      )}
    </section>
  );
}

/** «Обзор» — общий для всех ролей; разделы следующих слайсов появятся здесь (Приложение A). */
export function OverviewScreen() {
  return (
    <>
      <PageHeader title={t('admin.overview.title')} />
      <div className="page-body">
        <ApiStatus />
        <EmptyState title={t('admin.overview.empty')} />
      </div>
    </>
  );
}
