import { t } from '@pokatim/i18n';
import { Link } from '@tanstack/react-router';

import { PageHeader } from '../../ui';

/** Неизвестный путь внутри панели. */
export function NotFoundScreen() {
  return (
    <>
      <PageHeader title={t('admin.notFound.title')} />
      <div className="page-body">
        <p className="muted t-body">{t('admin.notFound.message')}</p>
        <p className="page-body">
          <Link to="/" className="link t-body">
            {t('admin.notFound.toOverview')}
          </Link>
        </p>
      </div>
    </>
  );
}
