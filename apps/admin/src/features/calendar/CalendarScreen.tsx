import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  CALENDAR_START_STATUSES,
  type CalendarStartStatus,
  type PanelCalendarStart,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { api } from '../../api';
import { formatLocalDate } from '../../format';
import { isConflict, isForbidden } from '../../session/errors';
import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  ReasonDialog,
  SelectField,
  SplitLayout,
  StatusTag,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { TicketingSummary } from '../tickets/TicketingSummary';
import { CALENDAR_QUERY_KEY, CalendarForm } from './CalendarForm';

const PAGE_SIZE = 50;
const ALL = 'all';
const column = createColumnHelper<PanelCalendarStart>();

const actionErrorText = (error: unknown) => {
  if (isNetworkError(error)) return t('error.network');
  if (isConflict(error)) return t('admin.conflict.title');
  return apiErrorOf(error) ? t('admin.saveFailed') : t('error.unknown');
};

const dateOf = (start: PanelCalendarStart) =>
  start.endsOn
    ? t('admin.calendar.dateRange', {
        from: formatLocalDate(start.startsOn),
        to: formatLocalDate(start.endsOn),
      })
    : formatLocalDate(start.startsOn);

/**
 * «Календарь» (`calendar.manage`, только admin): таблица записей (и прошедших, и снятых) и форма в правой колонке;
 * «Снять с публикации» — с причиной (в журнал), «Вернуть в календарь».
 */
export function CalendarScreen() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>(ALL);
  const [editing, setEditing] = useState<PanelCalendarStart>();
  const [formKey, setFormKey] = useState(0);
  const [unpublishing, setUnpublishing] = useState<PanelCalendarStart>();
  const [failure, setFailure] = useState<string>();
  const filterStatus = status === ALL ? undefined : (status as CalendarStartStatus);

  const pages = useInfiniteQuery({
    queryKey: [...CALENDAR_QUERY_KEY, filterStatus ?? ALL],
    queryFn: ({ pageParam }) =>
      api.listCalendar({
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
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
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: CALENDAR_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };
  const republish = useMutation({
    mutationFn: (start: PanelCalendarStart) =>
      api.republishCalendarStart(start.id, { version: start.version }),
    onSuccess: refresh,
    onError: (error) => setFailure(actionErrorText(error)),
  });
  const edit = (start: PanelCalendarStart | undefined) => {
    setEditing(start);
    setFormKey((key) => key + 1);
  };

  const columns = useMemo(
    () => [
      column.accessor('startsOn', {
        header: t('admin.calendar.column.date'),
        cell: (info) => dateOf(info.row.original),
        enableSorting: false,
      }),
      column.accessor('title', { header: t('admin.calendar.column.title'), enableSorting: false }),
      column.accessor('discipline', {
        header: t('admin.calendar.column.discipline'),
        cell: (info) => t(`domain.discipline.${info.getValue()}`),
        enableSorting: false,
      }),
      column.accessor('city', { header: t('admin.calendar.column.city'), enableSorting: false }),
      column.accessor('status', {
        header: t('admin.calendar.column.status'),
        cell: (info) => (
          <StatusTag tone={info.getValue() === 'published' ? 'success' : 'neutral'}>
            {t(`admin.calendar.status.${info.getValue()}`)}
          </StatusTag>
        ),
        enableSorting: false,
      }),
      column.display({
        id: 'actions',
        header: () => <span className="visually-hidden">{t('admin.calendar.column.actions')}</span>,
        cell: (info) => {
          const start = info.row.original;
          return (
            <span className="table__actions">
              <Button
                size="sm"
                aria-label={`${t('admin.calendar.edit')}: ${start.title}`}
                onClick={() => edit(start)}
              >
                {t('admin.calendar.edit')}
              </Button>
              {start.status === 'published' ? (
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={`${t('admin.calendar.unpublish')}: ${start.title}`}
                  onClick={() => setUnpublishing(start)}
                >
                  {t('admin.calendar.unpublish')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  aria-label={`${t('admin.calendar.republish')}: ${start.title}`}
                  busy={republish.isPending && republish.variables?.id === start.id}
                  onClick={() => {
                    setFailure(undefined);
                    republish.mutate(start);
                  }}
                >
                  {t('admin.calendar.republish')}
                </Button>
              )}
            </span>
          );
        },
      }),
    ],
    [republish],
  );

  return (
    <>
      <PageHeader
        title={t('admin.calendar.title')}
        meta={t('admin.calendar.lead')}
        actions={
          <Button variant="primary" onClick={() => edit(undefined)}>
            {t('admin.calendar.new')}
          </Button>
        }
      />
      <div className="page-body">
        {failure ? (
          <Banner tone="error" role="alert">
            {failure}
          </Banner>
        ) : null}
        <SplitLayout
          rail={
            <>
              <CalendarForm key={formKey} start={editing} onDone={() => edit(undefined)} />
              {editing ? (
                <TicketingSummary key={editing.id} kind="calendar" eventId={editing.id} />
              ) : null}
            </>
          }
        >
          <DataTable
            caption={t('admin.calendar.title')}
            columns={columns}
            query={query}
            getRowId={(start) => start.id}
            empty={<EmptyState title={t('admin.calendar.empty')} />}
            renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
            toolbar={
              <SelectField
                label={t('admin.calendar.filter.status')}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                options={[
                  { value: ALL, label: t('admin.filter.all') },
                  ...CALENDAR_START_STATUSES.map((value) => ({
                    value,
                    label: t(`admin.calendar.status.${value}`),
                  })),
                ]}
              />
            }
            footer={
              pages.hasNextPage ? (
                <div className="table__more">
                  <Button
                    busy={pages.isFetchingNextPage}
                    onClick={() => void pages.fetchNextPage()}
                  >
                    {t('admin.more')}
                  </Button>
                </div>
              ) : null
            }
          />
        </SplitLayout>
      </div>
      <ReasonDialog
        open={unpublishing !== undefined}
        title={t('admin.calendar.unpublishTitle', { title: unpublishing?.title ?? '' })}
        consequences={t('admin.calendar.unpublishConsequences')}
        confirmLabel={t('admin.calendar.unpublish')}
        destructive
        errorText={actionErrorText}
        onConfirm={async (reason) => {
          if (!unpublishing) return;
          await api.unpublishCalendarStart(unpublishing.id, {
            version: unpublishing.version,
            reason,
          });
          await refresh();
        }}
        onClose={() => setUnpublishing(undefined)}
      />
    </>
  );
}
