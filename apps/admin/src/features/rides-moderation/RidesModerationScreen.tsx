import type { ModerationRideRow, RideModerationState } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { isForbidden } from '../../session/errors';
import { Button, DataTable, EmptyState, PageHeader, StatusTag, ToggleChip } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { RIDE_STATUS_TONE, rideStatusLabel, type RidesModerationSearch } from './moderation-format';
import { RIDES_MODERATION_QUERY_KEY } from './rides-moderation-query';

const PAGE_SIZE = 50;
const column = createColumnHelper<ModerationRideRow>();
const STATES: readonly RideModerationState[] = ['open', 'hidden'];

const rideColumn = column.accessor('title', {
  header: t('admin.ridesModeration.column.ride'),
  cell: (info) => (
    <>
      <Link
        className="link"
        to="/rides-moderation/$rideId"
        params={{ rideId: info.row.original.id }}
      >
        {info.getValue()}
      </Link>
      <div className="t-meta">{t(`domain.city.${info.row.original.city}`)}</div>
    </>
  ),
  enableSorting: false,
});
const startColumn = column.accessor('startsAt', {
  header: t('admin.ridesModeration.column.startsAt'),
  cell: (info) => formatDateTimeLong(info.getValue()),
  enableSorting: false,
});
const reportsColumn = column.accessor('openReportCount', {
  header: t('admin.ridesModeration.column.reports'),
  cell: (info) => {
    const reason = info.row.original.topReason;
    return reason
      ? t('admin.ridesModeration.reports', {
          count: info.getValue(),
          reason: t(`domain.rideReportReason.${reason}`),
        })
      : t('admin.ridesModeration.none');
  },
  enableSorting: false,
});
const hiddenAtColumn = column.accessor('hiddenAt', {
  header: t('admin.ridesModeration.column.hiddenAt'),
  cell: (info) => {
    const value = info.getValue();
    return value ? formatDateTimeLong(value) : t('admin.ridesModeration.none');
  },
  enableSorting: false,
});
const statusColumn = column.accessor('status', {
  header: t('admin.ridesModeration.column.status'),
  cell: (info) => (
    <StatusTag tone={RIDE_STATUS_TONE[info.getValue()]}>
      {rideStatusLabel(info.getValue())}
    </StatusTag>
  ),
  enableSorting: false,
});

/**
 * «Модерация райдов» (`rides.moderate`, 05b): вкладки «Открытые жалобы» (новые жалобы сверху) и «Скрытые» (по
 * времени скрытия) — в URL; «Показать ещё» по курсору сервера. Строка → карточка с действиями.
 */
export function RidesModerationScreen({
  search,
  onSearch,
}: {
  search: RidesModerationSearch;
  onSearch: (next: RidesModerationSearch) => void;
}) {
  const state = search.state ?? 'open';
  const pages = useInfiniteQuery({
    queryKey: [...RIDES_MODERATION_QUERY_KEY, 'list', state],
    queryFn: ({ pageParam }) =>
      api.listModerationRides({
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
    () => [
      rideColumn,
      startColumn,
      state === 'open' ? reportsColumn : hiddenAtColumn,
      statusColumn,
    ],
    [state],
  );

  return (
    <>
      <PageHeader title={t('admin.ridesModeration.title')} meta={t('admin.ridesModeration.lead')} />
      <div className="page-body">
        <DataTable
          caption={t('admin.ridesModeration.title')}
          columns={columns}
          query={query}
          getRowId={(row) => row.id}
          empty={<EmptyState title={t(`admin.ridesModeration.empty.${state}`)} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          toolbar={
            <div className="chips" role="group" aria-label={t('admin.ridesModeration.filter')}>
              {STATES.map((value) => (
                <ToggleChip
                  key={value}
                  pressed={state === value}
                  onToggle={() => onSearch(value === 'open' ? {} : { state: value })}
                >
                  {t(`admin.ridesModeration.state.${value}`)}
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
