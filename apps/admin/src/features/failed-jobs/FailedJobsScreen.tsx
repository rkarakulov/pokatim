import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { type FailedJobRow, OUTBOX_STUCK_MINUTES } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { httpStatus, isForbidden } from '../../session/errors';
import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  ReasonDialog,
  SelectField,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';

const PAGE_SIZE = 50;
export const FAILED_JOBS_QUERY_KEY = ['admin', 'failed-jobs'] as const;

type Action = 'retry' | 'delete';
type Notice = 'retried' | 'deleted' | 'stale';

const column = createColumnHelper<FailedJobRow>();
const label = (row: FailedJobRow) => `${row.queue} · ${row.jobId}`;

/** Ошибка действия в окне причины (404/409 — не здесь: баннер над списком и перечитывание). */
const actionErrorText = (error: unknown) => {
  if (isNetworkError(error)) return t('error.network');
  return apiErrorOf(error) ? t('admin.saveFailed') : t('error.unknown');
};

/**
 * «Упавшие задачи» (`platform.stats`, только admin; admin-failed-jobs): финальные провалы задач BullMQ по всем
 * очередям, новые сверху; фильтр очереди со счётчиками. «Повторить» и «Удалить» — `ReasonDialog` (причина — в журнал);
 * задача уже изменилась (404/409) — баннер и перечитывание. Сверху — предупреждение о событиях outbox, не переданных в
 * очереди дольше `OUTBOX_STUCK_MINUTES` (только чтение: публикатор повторяет сам). Данных задачи экран не получает.
 */
export function FailedJobsScreen() {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState('');
  const [target, setTarget] = useState<{ row: FailedJobRow; action: Action }>();
  const [notice, setNotice] = useState<Notice>();
  const view = useQuery({
    queryKey: [...FAILED_JOBS_QUERY_KEY, queue],
    queryFn: () => api.listFailedJobs({ limit: PAGE_SIZE, ...(queue ? { queue } : {}) }),
    // при смене очереди фильтр и счётчики не пропадают до ответа
    placeholderData: keepPreviousData,
  });
  const query = {
    data: view.data?.items,
    isError: view.isError,
    error: view.error,
    fetchStatus: view.fetchStatus,
    refetch: () => view.refetch(),
  };
  const counts = view.data?.queues ?? [];
  const total = counts.reduce((sum, row) => sum + row.failed, 0);
  const outbox = view.data?.outbox;
  const shown = view.data?.items.length ?? 0;
  const matching = queue ? (counts.find((row) => row.queue === queue)?.failed ?? 0) : total;

  const act = async (reason: string) => {
    if (!target) return;
    const { row, action } = target;
    setNotice(undefined);
    try {
      const call = action === 'retry' ? api.retryFailedJob : api.deleteFailedJob;
      await call(row.queue, row.jobId, { reason });
      setNotice(action === 'retry' ? 'retried' : 'deleted');
    } catch (error) {
      const status = httpStatus(error);
      if (status !== 404 && status !== 409) throw error;
      setNotice('stale');
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: FAILED_JOBS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
    ]);
  };

  const columns = [
    column.accessor('queue', {
      header: t('admin.failedJobs.column.queue'),
      enableSorting: false,
    }),
    column.accessor('name', {
      header: t('admin.failedJobs.column.name'),
      // id — для сверки с логом worker и Redis; событие outbox — тот же id
      cell: (info) => (
        <>
          {info.getValue()}
          <br />
          <span className="t-meta">{info.row.original.jobId}</span>
        </>
      ),
      enableSorting: false,
    }),
    column.accessor('error', {
      header: t('admin.failedJobs.column.error'),
      cell: (info) => info.getValue() ?? t('admin.failedJobs.noError'),
      enableSorting: false,
    }),
    column.display({
      id: 'attempts',
      header: t('admin.failedJobs.column.attempts'),
      cell: (info) => {
        const { attemptsMade, attempts } = info.row.original;
        return attempts === null
          ? attemptsMade
          : t('admin.failedJobs.attempts', { made: attemptsMade, max: attempts });
      },
    }),
    column.accessor('failedAt', {
      header: t('admin.failedJobs.column.failedAt'),
      cell: (info) => {
        const at = info.getValue();
        return at ? formatDateTimeLong(at) : t('admin.failedJobs.none');
      },
      enableSorting: false,
    }),
    column.display({
      id: 'actions',
      header: () => <span className="visually-hidden">{t('admin.failedJobs.column.actions')}</span>,
      cell: (info) => (
        <span className="table__actions">
          <Button
            size="sm"
            aria-label={t('admin.failedJobs.retryFor', { label: label(info.row.original) })}
            onClick={() => setTarget({ row: info.row.original, action: 'retry' })}
          >
            {t('admin.failedJobs.retry')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            aria-label={t('admin.failedJobs.deleteFor', { label: label(info.row.original) })}
            onClick={() => setTarget({ row: info.row.original, action: 'delete' })}
          >
            {t('admin.failedJobs.delete')}
          </Button>
        </span>
      ),
    }),
  ];

  const options = [
    { value: '', label: t('admin.failedJobs.allQueues', { count: total }) },
    ...counts
      .filter((row) => row.failed > 0 || row.queue === queue)
      .map((row) => ({
        value: row.queue,
        label: t('admin.failedJobs.queueOption', { queue: row.queue, count: row.failed }),
      })),
  ];

  return (
    <>
      <PageHeader title={t('admin.failedJobs.title')} meta={t('admin.failedJobs.lead')} />
      <div className="page-body">
        {outbox && outbox.stuck > 0 && outbox.oldestAt ? (
          <Banner tone="warning" title={t('admin.failedJobs.outbox.title')}>
            <p>
              {t('admin.failedJobs.outbox.stuck', {
                minutes: OUTBOX_STUCK_MINUTES,
                count: outbox.stuck,
                at: formatDateTimeLong(outbox.oldestAt),
              })}
            </p>
            <ul>
              {outbox.items.map((item) => (
                <li key={item.id} className="t-meta">
                  {t('admin.failedJobs.outbox.item', {
                    type: item.type,
                    at: formatDateTimeLong(item.createdAt),
                  })}
                </li>
              ))}
            </ul>
          </Banner>
        ) : null}
        {notice ? (
          <Banner tone={notice === 'stale' ? 'warning' : 'neutral'}>
            {t(`admin.failedJobs.notice.${notice}`)}
          </Banner>
        ) : null}
        <div className="toolbar">
          <SelectField
            label={t('admin.failedJobs.queue')}
            options={options}
            value={queue}
            onChange={(event) => setQueue(event.target.value)}
          />
          {matching > shown && shown > 0 ? (
            <p className="t-meta">{t('admin.failedJobs.shown', { shown, total: matching })}</p>
          ) : null}
        </div>
        <DataTable
          caption={t('admin.failedJobs.title')}
          columns={columns}
          query={query}
          getRowId={(row) => `${row.queue}/${row.jobId}`}
          empty={
            <EmptyState
              title={t(queue ? 'admin.failedJobs.emptyQueue' : 'admin.failedJobs.empty')}
            />
          }
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
        />
      </div>
      <ReasonDialog
        open={target !== undefined}
        title={
          target
            ? t(
                target.action === 'retry'
                  ? 'admin.failedJobs.retryTitle'
                  : 'admin.failedJobs.deleteTitle',
                { label: label(target.row) },
              )
            : ''
        }
        consequences={t(
          target?.action === 'delete'
            ? 'admin.failedJobs.deleteConsequences'
            : 'admin.failedJobs.retryConsequences',
        )}
        confirmLabel={t(
          target?.action === 'delete' ? 'admin.failedJobs.delete' : 'admin.failedJobs.retry',
        )}
        destructive={target?.action === 'delete'}
        errorText={actionErrorText}
        onConfirm={act}
        onClose={() => setTarget(undefined)}
      />
    </>
  );
}
