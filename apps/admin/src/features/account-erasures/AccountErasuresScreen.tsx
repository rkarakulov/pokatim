import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import type { AccountErasureRow } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { httpStatus, isForbidden } from '../../session/errors';
import { Banner, Button, DataTable, EmptyState, PageHeader, ReasonDialog } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { riderLabel } from '../results/results-format';

const PAGE_SIZE = 50;
export const ACCOUNT_ERASURES_QUERY_KEY = ['admin', 'account-erasures'] as const;

type Notice = 'queued' | 'recent' | 'stale';

const column = createColumnHelper<AccountErasureRow>();

/** Сбой: «Шаг · код» или «Сбоев не записано» (worker не дошёл до задачи). */
const failureLabel = ({ lastFailure }: AccountErasureRow) =>
  lastFailure
    ? t('admin.accountErasures.failure', {
        step: t(`admin.accountErasures.step.${lastFailure.step}`),
        code: lastFailure.code,
      })
    : t('admin.accountErasures.noFailure');

/** Ошибка повтора в окне причины (404/409 — не здесь: баннер над списком). */
const retryErrorText = (error: unknown) => {
  if (isNetworkError(error)) return t('error.network');
  return apiErrorOf(error) ? t('admin.saveFailed') : t('error.unknown');
};

/**
 * «Сбои удаления аккаунтов» (`platform.stats`, только admin; erasure-failures): удаления, чья фоновая очистка не
 * завершилась за сутки (та же выборка, что карточка «Обзора»), самые давние первыми, «Показать ещё» по курсору.
 * Подпись — «Участник ·<id>», без e-mail и имени. «Повторить» — `ReasonDialog` (причина — в журнал); уже запрошен —
 * сообщение без второй записи; удаление успело завершиться (404/409) — баннер и перечитывание списка.
 */
export function AccountErasuresScreen() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AccountErasureRow>();
  const [notice, setNotice] = useState<Notice>();
  const pages = useInfiniteQuery({
    queryKey: [...ACCOUNT_ERASURES_QUERY_KEY, 'list'],
    queryFn: ({ pageParam }) =>
      api.listAccountErasures({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
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

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ACCOUNT_ERASURES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
    ]);

  const retry = async (reason: string) => {
    if (!target) return;
    setNotice(undefined);
    try {
      const result = await api.retryAccountErasure(target.userId, { reason });
      setNotice(result.queued ? 'queued' : 'recent');
    } catch (error) {
      const status = httpStatus(error);
      if (status !== 404 && status !== 409) throw error;
      setNotice('stale');
    }
    await refresh();
  };

  const columns = [
    column.accessor('userId', {
      header: t('admin.accountErasures.column.account'),
      // полный id — для сверки с логом worker (`user=<uid>`) и runbook: хвост в подписи не уникален
      cell: (info) => (
        <>
          {riderLabel(info.getValue())}
          <br />
          <span className="t-meta">{info.getValue()}</span>
        </>
      ),
      enableSorting: false,
    }),
    column.accessor('deletedAt', {
      header: t('admin.accountErasures.column.deletedAt'),
      cell: (info) => formatDateTimeLong(info.getValue()),
      enableSorting: false,
    }),
    column.display({
      id: 'failure',
      header: t('admin.accountErasures.column.failure'),
      cell: (info) => failureLabel(info.row.original),
    }),
    column.display({
      id: 'failedAt',
      header: t('admin.accountErasures.column.failedAt'),
      cell: (info) => {
        const at = info.row.original.lastFailure?.at;
        return at ? formatDateTimeLong(at) : t('admin.accountErasures.none');
      },
    }),
    column.accessor('failedAttempts', {
      header: t('admin.accountErasures.column.attempts'),
      enableSorting: false,
    }),
    column.accessor('retryRequestedAt', {
      header: t('admin.accountErasures.column.retryRequestedAt'),
      cell: (info) => {
        const at = info.getValue();
        return at ? formatDateTimeLong(at) : t('admin.accountErasures.none');
      },
      enableSorting: false,
    }),
    column.display({
      id: 'actions',
      header: () => (
        <span className="visually-hidden">{t('admin.accountErasures.column.actions')}</span>
      ),
      cell: (info) => (
        <Button
          size="sm"
          aria-label={t('admin.accountErasures.retryFor', {
            label: riderLabel(info.row.original.userId),
          })}
          onClick={() => setTarget(info.row.original)}
        >
          {t('admin.accountErasures.retry')}
        </Button>
      ),
    }),
  ];

  const crumb = (
    <Link className="link" to="/">
      {t('admin.overview.title')}
    </Link>
  );

  return (
    <>
      <PageHeader
        crumb={crumb}
        title={t('admin.accountErasures.title')}
        meta={t('admin.accountErasures.lead')}
      />
      <div className="page-body">
        {notice ? (
          <Banner tone={notice === 'stale' ? 'warning' : 'neutral'}>
            {t(`admin.accountErasures.notice.${notice}`)}
          </Banner>
        ) : null}
        <DataTable
          caption={t('admin.accountErasures.title')}
          columns={columns}
          query={query}
          getRowId={(row) => row.userId}
          empty={<EmptyState title={t('admin.accountErasures.empty')} />}
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
      <ReasonDialog
        open={target !== undefined}
        title={
          target ? t('admin.accountErasures.retryTitle', { label: riderLabel(target.userId) }) : ''
        }
        consequences={t('admin.accountErasures.retryConsequences')}
        confirmLabel={t('admin.accountErasures.retry')}
        errorText={retryErrorText}
        onConfirm={retry}
        onClose={() => setTarget(undefined)}
      />
    </>
  );
}
