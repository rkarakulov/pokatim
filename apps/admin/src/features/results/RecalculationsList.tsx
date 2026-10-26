import type { PanelProtocolRecalculation } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useId } from 'react';

import { formatDateTime } from '../../format';
import { DataTable, EmptyState } from '../../ui';
import { riderLabel } from './results-format';
import { recalculationsQuery } from './results-query';

const column = createColumnHelper<PanelProtocolRecalculation>();
/** DQ по решению спора (RC-13): `reason` записи — `dispute:<disputeId>`. */
const DISPUTE_REASON = 'dispute:';

const columns = [
  column.accessor('at', {
    header: t('admin.results.recalc.column.at'),
    cell: (info) => <time dateTime={info.getValue()}>{formatDateTime(info.getValue())}</time>,
    enableSorting: false,
  }),
  column.accessor('kind', {
    header: t('admin.results.recalc.column.kind'),
    cell: (info) => {
      const { revision } = info.row.original;
      const kind = t(`admin.results.recalc.kind.${info.getValue()}`);
      return revision === null
        ? kind
        : `${kind}, ${t('admin.results.recalc.revision', { revision })}`;
    },
    enableSorting: false,
  }),
  column.accessor('entryId', {
    header: t('admin.results.recalc.column.rider'),
    cell: (info) => {
      const entryId = info.getValue();
      return entryId ? riderLabel(entryId) : '—';
    },
    enableSorting: false,
  }),
  column.accessor((row) => row.actor.displayName, {
    id: 'actor',
    header: t('admin.results.recalc.column.actor'),
    enableSorting: false,
  }),
  column.accessor('reason', {
    header: t('admin.results.recalc.column.reason'),
    cell: (info) => {
      const reason = info.getValue();
      const disputeId = reason.startsWith(DISPUTE_REASON)
        ? reason.slice(DISPUTE_REASON.length)
        : null;
      return disputeId ? (
        <Link className="link" to="/disputes/$disputeId" params={{ disputeId }}>
          {t('admin.results.recalc.disputeReason', { id: disputeId.slice(-6) })}
        </Link>
      ) : (
        reason
      );
    },
    enableSorting: false,
  }),
];

/** «История пересчётов» (новые сверху): публикация, DQ, отмена DQ, запуск и применение перепроверки. */
export function RecalculationsList({ raceId }: { raceId: string }) {
  const titleId = useId();
  const recalculations = useQuery(recalculationsQuery(raceId));
  return (
    <section className="section" aria-labelledby={titleId}>
      <h2 id={titleId} className="section__title t-label">
        {t('admin.results.recalc.title')}
      </h2>
      <DataTable
        caption={t('admin.results.recalc.title')}
        columns={columns}
        query={{
          data: recalculations.data?.items,
          isError: recalculations.isError,
          error: recalculations.error,
          fetchStatus: recalculations.fetchStatus,
          refetch: () => recalculations.refetch(),
        }}
        getRowId={(row) => row.id}
        empty={<EmptyState title={t('admin.results.recalc.empty')} />}
      />
    </section>
  );
}
