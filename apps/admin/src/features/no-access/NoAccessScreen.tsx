import { t } from '@pokatim/i18n';

import { PageHeader } from '../../ui';

/** Раздел без права роли — внутри каркаса (сервер всё равно ответил бы 403). */
export function NoAccessScreen() {
  return (
    <>
      <PageHeader title={t('admin.noAccess.title')} />
      <p className="page-body muted t-body">{t('admin.noAccess.message')}</p>
    </>
  );
}
