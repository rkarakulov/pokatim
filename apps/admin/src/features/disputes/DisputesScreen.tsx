import type { DisputeStatus, PanelDisputeListItem } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { isForbidden } from '../../session/errors';
import { Button, DataTable, EmptyState, PageHeader, StatusTag, ToggleChip } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { riderLabel } from '../results/results-format';
import {
  ALL_STATUSES,
  DISPUTE_STATUS_TONE,
  type DisputesSearch,
  type DisputesStatusFilter,
} from './disputes-format';
import { DISPUTES_QUERY_KEY } from './disputes-query';

const PAGE_SIZE = 50;
const column = createColumnHelper<PanelDisputeListItem>();
const FILTERS: readonly DisputesStatusFilter[] = [
  'open',
  'upheld',
  'rejected',
  'withdrawn',
  ALL_STATUSES,
];

const columns = [
  column.accessor((row) => row.race.title, {
    id: 'race',
    header: t('admin.disputes.column.race'),
    enableSorting: false,
  }),
  column.accessor('targetEntryId', {
    header: t('admin.disputes.column.target'),
    cell: (info) => (
      <Link className="link" to="/disputes/$disputeId" params={{ disputeId: info.row.original.id }}>
        {riderLabel(info.getValue(), info.row.original.targetRiderName)}
      </Link>
    ),
    enableSorting: false,
  }),
  column.accessor('category', {
    header: t('admin.disputes.column.category'),
    cell: (info) => t(`admin.disputes.category.${info.getValue()}`),
    enableSorting: false,
  }),
  column.accessor('filedAt', {
    header: t('admin.disputes.column.filedAt'),
    cell: (info) => formatDateTimeLong(info.getValue()),
    enableSorting: false,
  }),
  column.accessor('decidableAt', {
    header: t('admin.disputes.column.decidableAt'),
    cell: (info) => formatDateTimeLong(info.getValue()),
    enableSorting: false,
  }),
  column.accessor('responded', {
    header: t('admin.disputes.column.responded'),
    cell: (info) => t(`admin.disputes.responded.${info.getValue() ? 'yes' : 'no'}`),
    enableSorting: false,
  }),
  column.accessor('status', {
    header: t('admin.disputes.column.status'),
    cell: (info) => (
      <StatusTag tone={DISPUTE_STATUS_TONE[info.getValue()]}>
        {t(`admin.disputes.status.${info.getValue()}`)}
      </StatusTag>
    ),
    enableSorting: false,
  }),
];

const filterLabel = (value: DisputesStatusFilter) =>
  value === ALL_STATUSES ? t('admin.disputes.filter.all') : t(`admin.disputes.status.${value}`);

/**
 * «Споры» (`disputes.read`, race-results-06): статус (по умолчанию «На рассмотрении») и гонка (`?raceId=` — со
 * ссылки чек-листа) — в URL; новые сверху, «Показать ещё» по курсору сервера. Строка → разбор.
 */
export function DisputesScreen({
  search,
  onSearch,
}: {
  search: DisputesSearch;
  onSearch: (next: DisputesSearch) => void;
}) {
  const filter: DisputesStatusFilter = search.status ?? 'open';
  const status: DisputeStatus | undefined = filter === ALL_STATUSES ? undefined : filter;
  const { raceId } = search;
  const pages = useInfiniteQuery({
    queryKey: [...DISPUTES_QUERY_KEY, 'list', filter, raceId ?? 'all'],
    queryFn: ({ pageParam }) =>
      api.listDisputes({
        ...(status ? { status } : {}),
        ...(raceId ? { raceId } : {}),
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = pages.data?.pages.flatMap((page) => page.items);
  const raceTitle = items?.find((item) => item.race.id === raceId)?.race.title;

  const setFilter = (value: DisputesStatusFilter) =>
    onSearch({ ...(value === 'open' ? {} : { status: value }), ...(raceId ? { raceId } : {}) });

  return (
    <>
      <PageHeader title={t('admin.disputes.title')} meta={t('admin.disputes.lead')} />
      <div className="page-body">
        <DataTable
          caption={t('admin.disputes.title')}
          columns={columns}
          query={{
            data: items,
            isError: pages.isError,
            error: pages.error,
            fetchStatus: pages.fetchStatus,
            refetch: () => pages.refetch(),
          }}
          getRowId={(row) => row.id}
          empty={<EmptyState title={t('admin.disputes.empty')} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          toolbar={
            <>
              <div className="chips" role="group" aria-label={t('admin.disputes.filter.status')}>
                {FILTERS.map((value) => (
                  <ToggleChip
                    key={value}
                    pressed={filter === value}
                    onToggle={() => setFilter(value)}
                  >
                    {filterLabel(value)}
                  </ToggleChip>
                ))}
              </div>
              {raceId ? (
                <div className="chips" role="group" aria-label={t('admin.disputes.filter.race')}>
                  {raceTitle ? (
                    <span className="t-body">
                      {t('admin.disputes.filter.raceValue', { title: raceTitle })}
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={() => onSearch(search.status ? { status: search.status } : {})}
                  >
                    {t('admin.disputes.filter.clearRace')}
                  </Button>
                </div>
              ) : null}
            </>
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
