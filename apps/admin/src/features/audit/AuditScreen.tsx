import { AUDIT_ACTIONS, type AuditAction, type AuditEntry } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';

import { api } from '../../api';
import { formatDateTime } from '../../format';
import { isForbidden } from '../../session/errors';
import { Button, DataTable, EmptyState, PageHeader, SelectField } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';

const PAGE_SIZE = 50;
const ALL = 'all';
const column = createColumnHelper<AuditEntry>();
const actionLabel = (action: AuditAction) => t(`admin.audit.action.${action}`);

function details(entry: AuditEntry): string {
  const from = entry.details?.roleFrom;
  const to = entry.details?.roleTo;
  if (from && to) {
    return t('admin.audit.roleChange', {
      from: t(`admin.role.${from}`),
      to: t(`admin.role.${to}`),
    });
  }
  const role = to ?? from;
  return role ? t(`admin.role.${role}`) : '';
}

const columns = [
  column.accessor('at', {
    header: t('admin.audit.column.at'),
    cell: (info) => <time dateTime={info.getValue()}>{formatDateTime(info.getValue())}</time>,
    enableSorting: false,
  }),
  column.accessor((entry) => (entry.actor.kind === 'user' ? entry.actor.displayName : ''), {
    id: 'actor',
    header: t('admin.audit.column.actor'),
    cell: (info) =>
      info.row.original.actor.kind === 'cli' ? t('admin.audit.cli') : info.getValue(),
    enableSorting: false,
  }),
  column.accessor('action', {
    header: t('admin.audit.column.action'),
    cell: (info) => {
      const extra = details(info.row.original);
      return extra ? `${actionLabel(info.getValue())}: ${extra}` : actionLabel(info.getValue());
    },
    enableSorting: false,
  }),
  column.accessor((entry) => entry.target?.displayName ?? '—', {
    id: 'target',
    header: t('admin.audit.column.target'),
    enableSorting: false,
  }),
  column.accessor((entry) => entry.reason ?? '—', {
    id: 'reason',
    header: t('admin.audit.column.reason'),
    enableSorting: false,
  }),
];

/**
 * «Журнал действий» (`audit.read`: admin и moderator): новые сверху, время — Europe/Minsk, фильтр действия,
 * «Показать ещё» по курсору сервера.
 */
export function AuditScreen() {
  const [action, setAction] = useState<string>(ALL);
  const filterAction = action === ALL ? undefined : (action as AuditAction);
  const pages = useInfiniteQuery({
    queryKey: ['admin', 'audit', filterAction ?? ALL],
    queryFn: ({ pageParam }) =>
      api.listAudit({
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(filterAction ? { action: filterAction } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const query = {
    data: pages.data?.pages.flatMap((page) => page.items),
    isError: pages.isError,
    error: pages.error,
    fetchStatus: pages.fetchStatus,
    refetch: () => pages.refetch(),
  };

  return (
    <>
      <PageHeader title={t('admin.audit.title')} meta={t('admin.timezone')} />
      <div className="page-body">
        <DataTable
          caption={t('admin.audit.title')}
          columns={columns}
          query={query}
          getRowId={(entry) => entry.id}
          empty={<EmptyState title={t('admin.audit.empty')} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          toolbar={
            <SelectField
              label={t('admin.audit.filter.action')}
              value={action}
              onChange={(event) => setAction(event.target.value)}
              options={[
                { value: ALL, label: t('admin.audit.filter.all') },
                ...AUDIT_ACTIONS.map((value) => ({ value, label: actionLabel(value) })),
              ]}
            />
          }
          footer={
            pages.hasNextPage ? (
              <div className="table__more">
                <Button busy={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                  {t('admin.audit.more')}
                </Button>
              </div>
            ) : null
          }
        />
      </div>
    </>
  );
}
