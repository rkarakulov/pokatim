import {
  RIDER_ROUTE_MODERATION_STATES,
  type RiderRouteModerationRow,
  type RiderRouteModerationState,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';

import { api } from '../../api';
import { formatDateTimeLong, formatKmFromMeters } from '../../format';
import { isForbidden } from '../../session/errors';
import { Button, DataTable, EmptyState, PageHeader, StatusTag, ToggleChip } from '../../ui';
import { ModerationTabs } from '../moderation/ModerationTabs';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import {
  RIDER_ROUTE_STATUS_TONE,
  riderRouteAuthor,
  riderRouteStatusLabel,
  type RiderRoutesSearch,
} from './rider-routes-format';
import { RIDER_ROUTES_QUERY_KEY } from './rider-routes-query';

const PAGE_SIZE = 50;
const column = createColumnHelper<RiderRouteModerationRow>();
const none = () => t('admin.riderRoutes.none');

const routeColumn = column.accessor('title', {
  header: t('admin.riderRoutes.column.route'),
  cell: (info) => (
    <>
      <Link className="link" to="/rider-routes/$routeId" params={{ routeId: info.row.original.id }}>
        {info.getValue()}
      </Link>
      <div className="t-meta">{t(`domain.city.${info.row.original.city}`)}</div>
    </>
  ),
  enableSorting: false,
});
const authorColumn = column.accessor('authorUserId', {
  header: t('admin.riderRoutes.column.author'),
  cell: (info) => riderRouteAuthor(info.getValue()),
  enableSorting: false,
});
const distanceColumn = column.accessor('distanceM', {
  header: t('admin.riderRoutes.column.distance'),
  cell: (info) => formatKmFromMeters(info.getValue()),
  enableSorting: false,
});
const submittedColumn = column.accessor('submittedAt', {
  header: t('admin.riderRoutes.column.submittedAt'),
  cell: (info) => formatDateTimeLong(info.getValue()),
  enableSorting: false,
});
const reportsColumn = column.accessor('openReportCount', {
  header: t('admin.riderRoutes.column.reports'),
  cell: (info) => {
    const reason = info.row.original.topReason;
    return reason
      ? t('admin.riderRoutes.reports', {
          count: info.getValue(),
          reason: t(`domain.routeReportReason.${reason}`),
        })
      : none();
  },
  enableSorting: false,
});
const hiddenAtColumn = column.accessor('hiddenAt', {
  header: t('admin.riderRoutes.column.hiddenAt'),
  cell: (info) => {
    const value = info.getValue();
    return value ? formatDateTimeLong(value) : none();
  },
  enableSorting: false,
});
const statusColumn = column.accessor('status', {
  header: t('admin.riderRoutes.column.status'),
  cell: (info) => (
    <StatusTag tone={RIDER_ROUTE_STATUS_TONE[info.getValue()]}>
      {riderRouteStatusLabel(info.getValue())}
    </StatusTag>
  ),
  enableSorting: false,
});

const TAB_COLUMN = {
  pending: submittedColumn,
  reported: reportsColumn,
  hidden: hiddenAtColumn,
} as const;

/**
 * «Маршруты райдеров» (`routes.moderate`, routes-06): вкладки «На проверке» (старые заявки сверху), «Жалобы» (новые
 * жалобы сверху) и «Скрытые» — в URL (`?tab=`); «Показать ещё» по курсору сервера. Автор — только `Райдер ·id` (N8).
 * Строка → страница заявки с картой и действиями.
 */
export function RiderRoutesScreen({
  search,
  onSearch,
}: {
  search: RiderRoutesSearch;
  onSearch: (next: RiderRoutesSearch) => void;
}) {
  const state: RiderRouteModerationState = search.tab ?? 'pending';
  const pages = useInfiniteQuery({
    queryKey: [...RIDER_ROUTES_QUERY_KEY, 'list', state],
    queryFn: ({ pageParam }) =>
      api.listRiderRoutes({
        state,
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
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
  const columns = useMemo(
    () => [routeColumn, authorColumn, distanceColumn, TAB_COLUMN[state], statusColumn],
    [state],
  );

  return (
    <>
      <PageHeader title={t('admin.riderRoutes.title')} meta={t('admin.riderRoutes.lead')} />
      <ModerationTabs />
      <div className="page-body">
        <DataTable
          caption={t('admin.riderRoutes.title')}
          columns={columns}
          query={query}
          getRowId={(row) => row.id}
          empty={<EmptyState title={t(`admin.riderRoutes.empty.${state}`)} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          toolbar={
            <div className="chips" role="group" aria-label={t('admin.riderRoutes.filter')}>
              {RIDER_ROUTE_MODERATION_STATES.map((value) => (
                <ToggleChip
                  key={value}
                  pressed={state === value}
                  onToggle={() => onSearch(value === 'pending' ? {} : { tab: value })}
                >
                  {t(`admin.riderRoutes.state.${value}`)}
                </ToggleChip>
              ))}
            </div>
          }
          footer={
            pages.hasNextPage ? (
              <div className="table__more">
                <Button busy={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                  {t('admin.more')}
                </Button>
              </div>
            ) : null
          }
        />
      </div>
    </>
  );
}
