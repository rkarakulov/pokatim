import {
  type EventTicketRow,
  formatTicketCode,
  type TicketEmailState,
  type TicketEventKind,
  type TicketStatus,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';

import { api } from '../../api';
import { formatDateTime } from '../../format';
import { Button, DataTable, EmptyState, StatusTag } from '../../ui';
import { formatCategory, ticketsKey } from './tickets-query';

const PAGE_SIZE = 50;
const column = createColumnHelper<EventTicketRow>();

const STATUS_TONE: Record<TicketStatus, 'success' | 'neutral' | 'error' | 'ink'> = {
  active: 'ink',
  checked_in: 'success',
  cancelled: 'neutral',
  event_cancelled: 'error',
};
const EMAIL_TONE: Record<TicketEmailState, 'success' | 'neutral' | 'error' | 'ink'> = {
  pending: 'neutral',
  sending: 'neutral',
  sent: 'success',
  skipped: 'neutral',
  failed: 'error',
};

const columns = [
  column.accessor('code', {
    header: t('admin.tickets.participants.column.code'),
    cell: (info) => formatTicketCode(info.getValue()),
    enableSorting: false,
  }),
  column.accessor('participantName', {
    header: t('admin.tickets.participants.column.name'),
    enableSorting: false,
  }),
  column.accessor((row) => formatCategory(row.category), {
    id: 'category',
    header: t('admin.tickets.participants.column.category'),
    enableSorting: false,
  }),
  column.accessor('status', {
    header: t('admin.tickets.participants.column.status'),
    cell: (info) => (
      <StatusTag tone={STATUS_TONE[info.getValue()]}>
        {t(`admin.tickets.status.${info.getValue()}`)}
      </StatusTag>
    ),
    enableSorting: false,
  }),
  column.accessor('checkedInAt', {
    header: t('admin.tickets.participants.column.checkedIn'),
    cell: (info) => {
      const value = info.getValue();
      return value ? <time dateTime={value}>{formatDateTime(value)}</time> : '—';
    },
    enableSorting: false,
  }),
  column.accessor('emailState', {
    header: t('admin.tickets.participants.column.email'),
    cell: (info) => (
      <StatusTag tone={EMAIL_TONE[info.getValue()]}>
        {t(`admin.tickets.email.${info.getValue()}`)}
      </StatusTag>
    ),
    enableSorting: false,
  }),
];

/**
 * «Участники» события (`tickets.checkin`): код, имя, группа или дистанция, статус, время отметки (Минск), письмо
 * (`failed` — видимый провал, RC-T11); «Показать ещё» по курсору сервера.
 */
export function ParticipantsSection({ kind, eventId }: { kind: TicketEventKind; eventId: string }) {
  const pages = useInfiniteQuery({
    queryKey: [...ticketsKey(kind, eventId), 'participants'],
    queryFn: ({ pageParam }) =>
      api.listEventTickets(kind, eventId, {
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return (
    <DataTable
      caption={t('admin.tickets.section.participants')}
      columns={columns}
      query={{
        data: pages.data?.pages.flatMap((page) => page.items),
        isError: pages.isError,
        error: pages.error,
        fetchStatus: pages.fetchStatus,
        refetch: () => pages.refetch(),
      }}
      getRowId={(row) => row.code}
      empty={<EmptyState title={t('admin.tickets.participants.empty')} />}
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
  );
}
