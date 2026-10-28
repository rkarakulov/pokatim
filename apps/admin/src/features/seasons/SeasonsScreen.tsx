import type { PanelSeason, SeasonPhase } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { formatLocalDate } from '../../format';
import { useCan } from '../../session/can';
import { isForbidden } from '../../session/errors';
import { Button, DataTable, EmptyState, PageHeader, SplitLayout, StatusTag } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { SeasonForm } from './SeasonForm';
import { seasonsQuery } from './seasons-query';

const column = createColumnHelper<PanelSeason>();
const PHASE_TONE: Record<SeasonPhase, 'ink' | 'neutral'> = {
  upcoming: 'neutral',
  current: 'ink',
  finished: 'neutral',
};

type Editing = { kind: 'new' } | { kind: 'edit'; season: PanelSeason };

/**
 * «Сезоны» (`races.read`; создание и изменение — `seasons.manage`, только admin): таблица и форма в правой колонке.
 * Без права изменения — таблица без кнопок и без формы.
 */
export function SeasonsScreen() {
  const canManage = useCan('seasons.manage');
  const seasons = useQuery(seasonsQuery);
  const [editing, setEditing] = useState<Editing>({ kind: 'new' });
  const [formKey, setFormKey] = useState(0);

  const columns = useMemo(
    () => [
      column.accessor('name', {
        header: t('admin.seasons.column.name'),
        cell: (info) => (
          <Link
            className="link"
            to="/seasons/$seasonId"
            params={{ seasonId: info.row.original.id }}
          >
            {info.getValue()}
          </Link>
        ),
      }),
      column.accessor('startsOn', {
        header: t('admin.seasons.column.startsOn'),
        cell: (info) => formatLocalDate(info.getValue()),
      }),
      column.accessor('endsOn', {
        header: t('admin.seasons.column.endsOn'),
        cell: (info) => formatLocalDate(info.getValue()),
      }),
      column.accessor('raceCount', { header: t('admin.seasons.column.raceCount') }),
      column.accessor('phase', {
        header: t('admin.seasons.column.phase'),
        cell: (info) => (
          <StatusTag tone={PHASE_TONE[info.getValue()]}>
            {t(`domain.seasonPhase.${info.getValue()}`)}
          </StatusTag>
        ),
      }),
      ...(canManage
        ? [
            column.display({
              id: 'actions',
              header: () => (
                <span className="visually-hidden">{t('admin.seasons.column.actions')}</span>
              ),
              cell: (info) => (
                <span className="table__actions">
                  <Button
                    size="sm"
                    aria-label={`${t('admin.seasons.edit')}: ${info.row.original.name}`}
                    onClick={() => {
                      setEditing({ kind: 'edit', season: info.row.original });
                      setFormKey((key) => key + 1);
                    }}
                  >
                    {t('admin.seasons.edit')}
                  </Button>
                </span>
              ),
            }),
          ]
        : []),
    ],
    [canManage],
  );

  const table = (
    <>
      <DataTable
        caption={t('admin.seasons.title')}
        columns={columns}
        query={seasons}
        getRowId={(season) => season.id}
        initialSorting={[{ id: 'startsOn', desc: true }]}
        empty={<EmptyState title={t('admin.seasons.empty')} />}
        renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
      />
      <p className="page-note t-meta">{t('admin.seasons.note')}</p>
    </>
  );

  return (
    <>
      <PageHeader
        title={t('admin.seasons.title')}
        meta={t('admin.seasons.lead')}
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing({ kind: 'new' });
                setFormKey((key) => key + 1);
              }}
            >
              {t('admin.seasons.new')}
            </Button>
          ) : null
        }
      />
      <div className="page-body">
        {canManage ? (
          <SplitLayout
            rail={
              <SeasonForm
                key={formKey}
                season={editing.kind === 'edit' ? editing.season : undefined}
                seasons={seasons.data ?? []}
                onDone={() => {
                  setEditing({ kind: 'new' });
                  setFormKey((key) => key + 1);
                }}
              />
            }
          >
            {table}
          </SplitLayout>
        ) : (
          table
        )}
      </div>
    </>
  );
}
