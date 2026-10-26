import type { PanelStandingRow } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useId } from 'react';

import { api } from '../../api';
import { formatElapsed } from '../../format';
import { useCan } from '../../session/can';
import { Banner, Button, DataTable, EmptyState, StatusTag } from '../../ui';
import type { OpenResultsDialog } from './results-actions';
import { placeLabel, RESULT_TONE, riderLabel } from './results-format';
import { standingsQuery } from './results-query';

const column = createColumnHelper<PanelStandingRow>();

const baseColumns = [
  column.accessor('place', {
    header: t('admin.results.column.place'),
    cell: (info) => placeLabel(info.getValue(), info.row.original.tied),
    enableSorting: false,
  }),
  column.accessor((row) => riderLabel(row.entryId, row.riderName), {
    id: 'rider',
    header: t('admin.results.column.rider'),
    enableSorting: false,
  }),
  column.accessor('elapsedSec', {
    header: t('admin.results.column.time'),
    cell: (info) => {
      const value = info.getValue();
      return value === null ? '—' : formatElapsed(value);
    },
    enableSorting: false,
  }),
  column.accessor('resultStatus', {
    header: t('admin.results.column.status'),
    cell: (info) => (
      <StatusTag tone={RESULT_TONE[info.getValue()]}>
        {t(`admin.results.resultStatus.${info.getValue()}`)}
      </StatusTag>
    ),
    enableSorting: false,
  }),
  column.accessor((row) => row.summary.total, {
    id: 'attempts',
    header: t('admin.results.column.attempts'),
    enableSorting: false,
  }),
];

/**
 * «Участники»: места и статусы считает сервер (до публикации — живые, после — текущая ревизия протокола). После
 * публикации с `results.revise` — «Дисквалифицировать» / «Отменить DQ» (D-27). Публичное имя — только с согласием
 * райдера; с `profiles.moderate` при имени — «Сбросить имя» (profile-02).
 */
export function StandingsTable({
  raceId,
  published,
  run,
  open,
}: {
  raceId: string;
  published: boolean;
  run: (call: () => Promise<unknown>) => Promise<void>;
  open: OpenResultsDialog;
}) {
  const titleId = useId();
  const canRevise = useCan('results.revise');
  const canModerate = useCan('profiles.moderate');
  const standings = useQuery(standingsQuery(raceId));

  /** «Дисквалифицировать» / «Отменить DQ» опубликованного результата (D-27). */
  const disqualifyAction = (row: PanelStandingRow) => {
    if (row.resultStatus === 'dq') {
      return (
        <Button
          size="sm"
          onClick={() =>
            open({
              title: t('admin.results.dialog.revokeDq'),
              consequences: t('admin.results.dialog.revokeDqConsequences'),
              confirmLabel: t('admin.results.action.revokeDq'),
              run: (reason) =>
                run(() => api.revokeDisqualification(raceId, { entryId: row.entryId, reason })),
            })
          }
        >
          {t('admin.results.action.revokeDq')}
        </Button>
      );
    }
    if (row.resultStatus !== 'final' && row.resultStatus !== 'revised') return null;
    return (
      <Button
        size="sm"
        variant="danger"
        onClick={() =>
          open({
            title: t('admin.results.dialog.disqualify'),
            consequences: t('admin.results.dialog.disqualifyConsequences'),
            confirmLabel: t('admin.results.action.disqualify'),
            destructive: true,
            run: (reason) =>
              run(() => api.disqualifyResult(raceId, { entryId: row.entryId, reason })),
          })
        }
      >
        {t('admin.results.action.disqualify')}
      </Button>
    );
  };

  const canDisqualify = published && canRevise;
  const actions =
    canDisqualify || canModerate
      ? column.display({
          id: 'actions',
          header: t('admin.results.column.actions'),
          cell: (info) => {
            const row = info.row.original;
            const dq = canDisqualify ? disqualifyAction(row) : null;
            const reset =
              canModerate && row.riderName !== null ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    open({
                      title: t('admin.results.dialog.resetName'),
                      consequences: t('admin.results.dialog.resetNameConsequences'),
                      confirmLabel: t('admin.results.action.resetName'),
                      destructive: true,
                      run: (reason) => run(() => api.resetRiderName(row.userId, { reason })),
                    })
                  }
                >
                  {t('admin.results.action.resetName')}
                </Button>
              ) : null;
            if (!dq && !reset) return null;
            return (
              <span className="table__actions">
                {dq}
                {reset}
              </span>
            );
          },
        })
      : null;

  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.results.standings.title')}
      </h2>
      {standings.data?.truncated ? (
        <Banner>
          {t('admin.results.standings.truncated', { count: standings.data.items.length })}
        </Banner>
      ) : null}
      <DataTable
        caption={t('admin.results.standings.title')}
        columns={actions ? [...baseColumns, actions] : baseColumns}
        query={{
          data: standings.data?.items,
          isError: standings.isError,
          error: standings.error,
          fetchStatus: standings.fetchStatus,
          refetch: () => standings.refetch(),
        }}
        getRowId={(row) => row.entryId}
        empty={<EmptyState title={t('admin.results.standings.empty')} />}
      />
    </section>
  );
}
