import type { RiderProfileModerationRow } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { isForbidden } from '../../session/errors';
import { Button, DataTable, EmptyState, PageHeader } from '../../ui';
import { ModerationTabs } from '../moderation/ModerationTabs';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { riderLabel } from '../results/results-format';
import { profileContentLabel } from './rider-profiles-format';
import { RIDER_PROFILES_QUERY_KEY } from './rider-profiles-query';

const PAGE_SIZE = 50;
const column = createColumnHelper<RiderProfileModerationRow>();

const columns = [
  column.accessor('userId', {
    header: t('admin.riderProfiles.column.rider'),
    cell: (info) => (
      <Link className="link" to="/rider-profiles/$userId" params={{ userId: info.getValue() }}>
        {riderLabel(info.getValue(), info.row.original.name)}
      </Link>
    ),
    enableSorting: false,
  }),
  column.accessor('openReportCount', {
    header: t('admin.riderProfiles.column.reports'),
    cell: (info) => {
      const reason = info.row.original.topReason;
      return reason
        ? t('admin.riderProfiles.reports', {
            count: info.getValue(),
            reason: t(`domain.profileReportReason.${reason}`),
          })
        : String(info.getValue());
    },
    enableSorting: false,
  }),
  column.accessor('lastReportAt', {
    header: t('admin.riderProfiles.column.lastReportAt'),
    cell: (info) => {
      const value = info.getValue();
      return value ? formatDateTimeLong(value) : t('admin.riderProfiles.none');
    },
    enableSorting: false,
  }),
  column.display({
    id: 'content',
    header: t('admin.riderProfiles.column.content'),
    cell: (info) => profileContentLabel(info.row.original),
  }),
];

/**
 * «Профили райдеров» (`profiles.moderate`, profile-moderation): очередь профилей с открытыми жалобами (последняя
 * жалоба сверху), «Показать ещё» по курсору сервера. Подпись — `riderLabel` (имя только при согласии, Q2); строка →
 * карточка с действиями.
 */
export function RiderProfilesScreen() {
  const pages = useInfiniteQuery({
    queryKey: [...RIDER_PROFILES_QUERY_KEY, 'list'],
    queryFn: ({ pageParam }) =>
      api.listRiderProfiles({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
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
      <PageHeader title={t('admin.riderProfiles.title')} meta={t('admin.riderProfiles.lead')} />
      <ModerationTabs />
      <div className="page-body">
        <DataTable
          caption={t('admin.riderProfiles.queue')}
          columns={columns}
          query={query}
          getRowId={(row) => row.userId}
          empty={<EmptyState title={t('admin.riderProfiles.empty')} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
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
