import type {
  BikeClass,
  PanelSeasonStandingCell,
  PanelSeasonStandingRow,
  PanelSeasonStandingsTableRef,
  ResultGroupKey,
  SeasonStandingsRace,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { Button, ChipGroup, DataTable, EmptyState } from '../../ui';
import { placeLabel, seasonRiderLabel } from '../results/results-format';
import {
  seasonStandingsKey,
  seasonStandingsTableQuery,
  type StandingsTableKey,
} from './standings-query';

const column = createColumnHelper<PanelSeasonStandingRow>();

/** Место «=N», участник, очки — колонки без гонок (и скелетон до сводки). */
export const STANDINGS_BASE_COLUMNS = [
  column.accessor('place', {
    header: t('admin.standings.column.place'),
    cell: (info) => placeLabel(info.getValue(), info.row.original.tied),
    enableSorting: false,
  }),
  column.accessor((row) => seasonRiderLabel(row.userId, row.riderName), {
    id: 'rider',
    header: t('admin.standings.column.rider'),
    enableSorting: false,
  }),
  column.accessor('points', {
    header: t('admin.standings.column.points'),
    enableSorting: false,
  }),
];

function cellText(cell: PanelSeasonStandingCell): string {
  if (cell.outcome === 'dq') return t('admin.standings.cellDq', { points: cell.points });
  if (cell.outcome === 'none') return t('admin.standings.cellNone');
  return t('admin.standings.cell', {
    place: placeLabel(cell.place, cell.tied),
    points: cell.points,
  });
}

/** «1 · 100», «=2 · 85», «DQ · 0», «—»; не в зачёте N лучших — приглушена, для скринридера — «не в зачёте». */
function RaceCell({ cell }: { cell: PanelSeasonStandingCell | undefined }) {
  if (!cell || cell.outcome === 'none') {
    return <span className="muted">{t('admin.standings.cellNone')}</span>;
  }
  if (cell.counted) return cellText(cell);
  return (
    <>
      <span className="muted">{cellText(cell)}</span>
      <span className="visually-hidden">{t('admin.standings.notCounted')}</span>
    </>
  );
}

const raceColumns = (races: readonly SeasonStandingsRace[]) =>
  races.map((race) =>
    column.display({
      id: `race-${race.id}`,
      header: race.title,
      cell: (info) => (
        <RaceCell cell={info.row.original.cells.find((cell) => cell.raceId === race.id)} />
      ),
    }),
  );

const sameKey = (ref: PanelSeasonStandingsTableRef, key: StandingsTableKey | null) =>
  key !== null && ref.bikeClass === key.bikeClass && ref.groupKey === key.group;

/**
 * Таблицы сезона «класс × группа» (только чтение): переключатели — только таблицы сводки, по умолчанию первая;
 * места, очки и зачёт N лучших — только с сервера. Курсор не привязан к снимку (08a LOW-2): другая `computedAt`
 * следующей страницы — подгруженное сбрасывается, таблица грузится заново с первой страницы.
 */
export function SeasonStandingsTable({
  seasonId,
  tables,
}: {
  seasonId: string;
  /** непустой список таблиц сводки (порядок сервера: классы, затем группы) */
  tables: readonly [PanelSeasonStandingsTableRef, ...PanelSeasonStandingsTableRef[]];
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<StandingsTableKey | null>(null);
  const selected = tables.find((ref) => sameKey(ref, picked)) ?? tables[0];
  const key: StandingsTableKey = { bikeClass: selected.bikeClass, group: selected.groupKey };
  const tableQuery = seasonStandingsTableQuery(seasonId, key);
  const pages = useInfiniteQuery(tableQuery);
  const loaded = pages.data?.pages;
  const items = loaded?.flatMap((page) => page.items);
  const races = loaded?.[0]?.races;
  const columns = useMemo(
    () => (races ? [...STANDINGS_BASE_COLUMNS, ...raceColumns(races)] : STANDINGS_BASE_COLUMNS),
    [races],
  );

  const classes = tables
    .map((ref) => ref.bikeClass)
    .filter((value, index, list) => list.indexOf(value) === index);
  const groups = tables.filter((ref) => ref.bikeClass === selected.bikeClass);

  const pickClass = (bikeClass: BikeClass) => {
    const first = tables.find((ref) => ref.bikeClass === bikeClass);
    if (first) setPicked({ bikeClass, group: first.groupKey });
  };
  const pickGroup = (group: ResultGroupKey) => setPicked({ bikeClass: selected.bikeClass, group });

  const loadMore = async () => {
    const result = await pages.fetchNextPage();
    const fetched = result.data?.pages ?? [];
    if (fetched.some((page) => page.computedAt !== fetched[0]?.computedAt)) {
      // снимок сменился между страницами: строки разных пересчётов не смешиваются
      await Promise.all([
        queryClient.resetQueries({ queryKey: tableQuery.queryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: seasonStandingsKey(seasonId), exact: true }),
      ]);
    }
  };

  return (
    <DataTable
      caption={t('admin.standings.title')}
      columns={columns}
      query={{
        data: items,
        isError: pages.isError,
        error: pages.error,
        fetchStatus: pages.fetchStatus,
        refetch: () => pages.refetch(),
      }}
      getRowId={(row) => String(row.order)}
      empty={
        <EmptyState title={t('admin.standings.empty')}>{t('admin.standings.emptyHint')}</EmptyState>
      }
      toolbar={
        <>
          <ChipGroup
            label={t('admin.standings.classFilter')}
            options={classes.map((value) => ({ value, label: t(`domain.bikeClass.${value}`) }))}
            value={[selected.bikeClass]}
            onChange={(next) =>
              pickClass(next.find((value) => value !== selected.bikeClass) ?? selected.bikeClass)
            }
          />
          <ChipGroup
            label={t('admin.standings.groupFilter')}
            options={groups.map((ref) => ({
              value: ref.groupKey,
              label: t(`results.group.${ref.groupKey}`),
            }))}
            value={[selected.groupKey]}
            onChange={(next) =>
              pickGroup(next.find((value) => value !== selected.groupKey) ?? selected.groupKey)
            }
          />
          <p className="page-note t-meta">
            {t('admin.standings.tableMeta', {
              group: t(`results.group.${selected.groupKey}`),
              bikeClass: t(`domain.bikeClass.${selected.bikeClass}`),
              counted: selected.racesCounted,
              total: selected.racesTotal,
              riders: selected.riders,
            })}
          </p>
        </>
      }
      footer={
        pages.hasNextPage ? (
          <div className="table__more">
            <Button busy={pages.isFetchingNextPage} onClick={() => void loadMore()}>
              {t('admin.more')}
            </Button>
          </div>
        ) : null
      }
    />
  );
}
