import {
  ATTEMPT_STATUSES,
  type AttemptStatus,
  type PanelRaceAttempt,
  type PanelRaceResults,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useId, useState } from 'react';

import { api } from '../../api';
import { formatDateTime, formatElapsed } from '../../format';
import { useCan } from '../../session/can';
import { Button, ChipGroup, DataTable, EmptyState, StatusTag } from '../../ui';
import type { OpenResultsDialog } from './results-actions';
import { FlagList } from './FlagList';
import { ATTEMPT_TONE, riderLabel, sensorsText } from './results-format';
import { attemptsQueryKey } from './results-query';

const PAGE_SIZE = 50;
/** Исключить можно до публикации из этих статусов (D-24); «Вернуть в обработку» — только исключённую. */
const EXCLUDABLE: readonly AttemptStatus[] = [
  'queued',
  'checking',
  'counted',
  'rejected',
  'failed',
];
const column = createColumnHelper<PanelRaceAttempt>();

/** Причина отказа, сбой проверки, причина снятия или исключения — что объясняет статус попытки. */
function attemptNote(attempt: PanelRaceAttempt): string {
  if (attempt.status === 'excluded' && attempt.review?.kind === 'excluded') {
    return t('admin.results.attempts.reviewReason', { reason: attempt.review.reason });
  }
  if (attempt.failure) return t(`admin.results.failure.${attempt.failure}`);
  if (attempt.withdrawReason) return t(`admin.results.withdrawReason.${attempt.withdrawReason}`);
  const [reason] = attempt.reasons;
  return reason ? t(`races.attempt.reason.${reason}`) : '—';
}

const baseColumns = [
  column.accessor('createdAt', {
    header: t('admin.results.column.createdAt'),
    cell: (info) => <time dateTime={info.getValue()}>{formatDateTime(info.getValue())}</time>,
    enableSorting: false,
  }),
  column.accessor((attempt) => riderLabel(attempt.entryId, attempt.riderName), {
    id: 'rider',
    header: t('admin.results.column.rider'),
    enableSorting: false,
  }),
  column.accessor('origin', {
    header: t('admin.results.column.source'),
    cell: (info) => t(`races.attempt.origin.${info.getValue()}`),
    enableSorting: false,
  }),
  column.accessor('status', {
    header: t('admin.results.column.status'),
    cell: (info) => (
      <>
        <StatusTag tone={ATTEMPT_TONE[info.getValue()]}>
          {t(`admin.results.attemptStatus.${info.getValue()}`)}
        </StatusTag>
        {info.row.original.hidden ? (
          <span className="muted t-meta"> · {t('admin.results.attempts.hidden')}</span>
        ) : null}
      </>
    ),
    enableSorting: false,
  }),
  column.display({
    id: 'note',
    header: t('admin.results.column.reason'),
    cell: (info) => attemptNote(info.row.original),
  }),
  column.accessor((attempt) => attempt.segment?.elapsedSec ?? null, {
    id: 'segment',
    header: t('admin.results.column.segment'),
    cell: (info) => {
      const value = info.getValue();
      return value === null ? '—' : formatElapsed(value);
    },
    enableSorting: false,
  }),
  // race-results-07: какие датчики есть в сегменте (без значений) и флаги датчиков с метрикой
  column.accessor('sensors', {
    header: t('admin.results.column.sensors'),
    cell: (info) => sensorsText(info.getValue()),
    enableSorting: false,
  }),
  column.display({
    id: 'attention',
    header: t('admin.results.column.attention'),
    cell: (info) => <FlagList flags={info.row.original.flags} />,
  }),
  column.accessor('engineVersion', {
    header: t('admin.results.column.engine'),
    cell: (info) => info.getValue() ?? '—',
    enableSorting: false,
  }),
];

/**
 * «Попытки» гонки — все, включая скрытые и финальные сбои; фильтр статуса — на сервере. До публикации с
 * `results.manage`: «Исключить трек» (и dead-letter — без «Повторить», D-23), «Вернуть в обработку», «Перепроверить
 * треки» (подсказка — проверенные прежней версией движка).
 */
export function AttemptsTable({
  summary,
  run,
  open,
}: {
  summary: PanelRaceResults;
  run: (call: () => Promise<unknown>) => Promise<void>;
  open: OpenResultsDialog;
}) {
  const titleId = useId();
  const { raceId } = summary;
  const canManage = useCan('results.manage');
  // черновик (экран открыт по URL) и отменённая гонка — действия сервер отклоняет
  const editable =
    canManage &&
    summary.protocol === null &&
    summary.phase !== 'cancelled' &&
    summary.phase !== 'draft';
  const [status, setStatus] = useState<AttemptStatus>();
  const pages = useInfiniteQuery({
    queryKey: attemptsQueryKey(raceId, status),
    queryFn: ({ pageParam }) =>
      api.listRaceAttempts(raceId, {
        limit: PAGE_SIZE,
        ...(status ? { status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const actions = editable
    ? column.display({
        id: 'actions',
        header: t('admin.results.column.actions'),
        cell: (info) => {
          const attempt = info.row.original;
          if (attempt.status === 'excluded') {
            return (
              <Button
                size="sm"
                onClick={() =>
                  open({
                    title: t('admin.results.dialog.restore'),
                    consequences: t('admin.results.dialog.restoreConsequences'),
                    confirmLabel: t('admin.results.action.restore'),
                    run: (reason) => run(() => api.restoreAttempt(raceId, attempt.id, { reason })),
                  })
                }
              >
                {t('admin.results.action.restore')}
              </Button>
            );
          }
          if (!EXCLUDABLE.includes(attempt.status)) return null;
          return (
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                open({
                  title: t('admin.results.dialog.exclude'),
                  consequences: t('admin.results.dialog.excludeConsequences'),
                  confirmLabel: t('admin.results.action.exclude'),
                  destructive: true,
                  run: (reason) => run(() => api.excludeAttempt(raceId, attempt.id, { reason })),
                })
              }
            >
              {t('admin.results.action.exclude')}
            </Button>
          );
        },
      })
    : null;

  const stale = summary.counts.staleEngine;
  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.results.attempts.title')}
      </h2>
      <DataTable
        caption={t('admin.results.attempts.title')}
        columns={actions ? [...baseColumns, actions] : baseColumns}
        query={{
          data: pages.data?.pages.flatMap((page) => page.items),
          isError: pages.isError,
          error: pages.error,
          fetchStatus: pages.fetchStatus,
          refetch: () => pages.refetch(),
        }}
        getRowId={(attempt) => attempt.id}
        empty={<EmptyState title={t('admin.results.attempts.empty')} />}
        toolbar={
          <>
            {/* один статус за раз: нажатый чип заменяет прежний, повторное нажатие — «все» */}
            <ChipGroup
              label={t('admin.results.attempts.filter')}
              options={ATTEMPT_STATUSES.map((value) => ({
                value,
                label: t(`admin.results.attemptStatus.${value}`),
              }))}
              value={status ? [status] : []}
              onChange={(next) => setStatus(next.find((value) => value !== status))}
            />
            {editable ? (
              <div className="toolbar__spacer">
                <Button
                  onClick={() =>
                    open({
                      title: t('admin.results.dialog.recheck'),
                      consequences: t('admin.results.dialog.recheckConsequences'),
                      confirmLabel: t('admin.results.action.recheck'),
                      run: (reason) => run(() => api.recheckRaceResults(raceId, { reason })),
                    })
                  }
                >
                  {t('admin.results.action.recheck')}
                </Button>
                {stale > 0 ? (
                  <p className="muted t-meta">
                    {t('admin.results.action.recheckHint', { count: stale })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        }
        footer={
          pages.hasNextPage ? (
            <div className="table__more">
              <Button busy={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                {t('admin.results.attempts.more')}
              </Button>
            </div>
          ) : null
        }
      />
    </section>
  );
}
