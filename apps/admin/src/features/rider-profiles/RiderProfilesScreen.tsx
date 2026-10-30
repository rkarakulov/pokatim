import type { RiderProfileModerationRow } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { isForbidden } from '../../session/errors';
import { Button, DataTable, EmptyState, PageHeader, ToggleChip } from '../../ui';
import { ModerationTabs } from '../moderation/ModerationTabs';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { riderLabel } from '../results/results-format';
import {
  openReasonsLabel,
  profileContentLabel,
  RIDER_PROFILE_QUEUE_REASONS,
  type RiderProfilesSearch,
} from './rider-profiles-format';
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
      const { topReason: reason, openReasons } = info.row.original;
      const reports = reason
        ? t('admin.riderProfiles.reports', {
            count: info.getValue(),
            reason: t(`domain.profileReportReason.${reason}`),
          })
        : String(info.getValue());
      // во «Все» видно, что среди жалоб есть имя (или другая причина), а не только главная
      return openReasons.length > 1 ? (
        <>
          {reports}
          <div className="t-meta">{openReasonsLabel(openReasons)}</div>
        </>
      ) : (
        reports
      );
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
 * жалоба сверху), «Показать ещё» по курсору сервера. Вкладки «Все / Имя / Фото / Клуб» — фильтр сервера по причине
 * открытой жалобы, в URL (`?reason=`); прочие причины строки — подписью под главной. Подпись — `riderLabel` (имя
 * только при согласии, Q2); строка → карточка с действиями.
 */
export function RiderProfilesScreen({
  search,
  onSearch,
}: {
  search: RiderProfilesSearch;
  onSearch: (next: RiderProfilesSearch) => void;
}) {
  const { reason } = search;
  const pages = useInfiniteQuery({
    queryKey: [...RIDER_PROFILES_QUERY_KEY, 'list', reason ?? 'all'],
    queryFn: ({ pageParam }) =>
      api.listRiderProfiles({
        ...(reason ? { reason } : {}),
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
          empty={<EmptyState title={t(`admin.riderProfiles.empty.${reason ?? 'all'}`)} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          toolbar={
            <div className="chips" role="group" aria-label={t('admin.riderProfiles.filter')}>
              {([undefined, ...RIDER_PROFILE_QUEUE_REASONS] as const).map((value) => (
                <ToggleChip
                  key={value ?? 'all'}
                  pressed={reason === value}
                  onToggle={() => onSearch(value ? { reason: value } : {})}
                >
                  {t(`admin.riderProfiles.filter.${value ?? 'all'}`)}
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
