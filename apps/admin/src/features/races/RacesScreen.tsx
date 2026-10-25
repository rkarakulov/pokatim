import {
  BIKE_CLASSES,
  type BikeClass,
  type PanelRace,
  type RacePhase,
  RACE_STATUSES,
  type RaceStatus,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';

import { api } from '../../api';
import { formatDateTimeLong } from '../../format';
import { useCan } from '../../session/can';
import { isForbidden } from '../../session/errors';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SelectField,
  StatusTag,
  ToggleChip,
} from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { seasonsQuery } from '../seasons/seasons-query';
import { RACES_QUERY_KEY } from './races-query';

/** Фильтры списка — в URL (`?seasonId&status&bikeClass&mine`). */
export interface RacesSearch {
  seasonId?: string;
  status?: RaceStatus;
  bikeClass?: BikeClass;
  mine?: boolean;
}

/** Разбор search-параметров: только известные значения (прочее отбрасывается). */
export function validateRacesSearch(search: Record<string, unknown>): RacesSearch {
  const pick = <T extends string>(values: readonly T[], value: unknown) =>
    values.includes(value as T) ? (value as T) : undefined;
  return {
    seasonId:
      typeof search.seasonId === 'string' && /^[0-9a-f-]{36}$/i.test(search.seasonId)
        ? search.seasonId
        : undefined,
    status: pick(RACE_STATUSES, search.status),
    bikeClass: pick(BIKE_CLASSES, search.bikeClass),
    mine: search.mine === true || search.mine === 'true' ? true : undefined,
  };
}

const PAGE_SIZE = 50;
const ALL = 'all';
const column = createColumnHelper<PanelRace>();
const PHASE_TONE: Record<RacePhase, 'ink' | 'neutral' | 'success' | 'error'> = {
  draft: 'neutral',
  upcoming: 'ink',
  open: 'success',
  closed: 'neutral',
  cancelled: 'error',
};

const columns = [
  column.accessor('title', {
    header: t('admin.races.column.title'),
    cell: (info) => (
      <Link className="link" to="/races/$raceId" params={{ raceId: info.row.original.id }}>
        {info.getValue()}
      </Link>
    ),
    enableSorting: false,
  }),
  column.accessor('bikeClass', {
    header: t('admin.races.column.bikeClass'),
    cell: (info) => t(`domain.bikeClass.${info.getValue()}`),
    enableSorting: false,
  }),
  column.accessor('windowStartsAt', {
    header: t('admin.races.column.window'),
    cell: (info) =>
      t('admin.races.window', {
        from: formatDateTimeLong(info.getValue()),
        to: formatDateTimeLong(info.row.original.windowEndsAt),
      }),
    enableSorting: false,
  }),
  column.accessor((race) => race.season?.name ?? '—', {
    id: 'season',
    header: t('admin.races.column.season'),
    enableSorting: false,
  }),
  column.accessor('phase', {
    header: t('admin.races.column.phase'),
    cell: (info) => (
      <StatusTag tone={PHASE_TONE[info.getValue()]}>
        {t(`domain.racePhase.${info.getValue()}`)}
      </StatusTag>
    ),
    enableSorting: false,
  }),
  column.accessor((race) => race.owner.displayName, {
    id: 'owner',
    header: t('admin.races.column.owner'),
    enableSorting: false,
  }),
];

/**
 * «Гонки» (`races.read`): таблица с фильтрами сезона, статуса, класса и «Мои» (в URL), «Показать ещё» по курсору
 * сервера. Организатор видит только свои — фильтр ставит сервер. «Новая гонка» — с `races.manage`.
 */
export function RacesScreen({
  search,
  onSearch,
}: {
  search: RacesSearch;
  onSearch: (next: RacesSearch) => void;
}) {
  const canManage = useCan('races.manage');
  const seasons = useQuery(seasonsQuery);
  const pages = useInfiniteQuery({
    queryKey: [...RACES_QUERY_KEY, 'list', search],
    queryFn: ({ pageParam }) =>
      api.listRaces({ ...search, limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
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
  const set = (patch: Partial<RacesSearch>) => onSearch({ ...search, ...patch });
  const select = <T extends string>(value: string) => (value === ALL ? undefined : (value as T));

  return (
    <>
      <PageHeader
        title={t('admin.races.title')}
        meta={t('admin.timezone')}
        actions={
          canManage ? (
            <Link to="/races/new" className="button button--primary t-panel-button">
              {t('admin.races.new')}
            </Link>
          ) : null
        }
      />
      <div className="page-body">
        <DataTable
          caption={t('admin.races.title')}
          columns={columns}
          query={query}
          getRowId={(race) => race.id}
          empty={<EmptyState title={t('admin.races.empty')} />}
          renderError={(error) => (isForbidden(error) ? <NoAccessScreen /> : undefined)}
          toolbar={
            <>
              <SelectField
                label={t('admin.races.filter.season')}
                value={search.seasonId ?? ALL}
                onChange={(event) => set({ seasonId: select(event.target.value) })}
                options={[
                  { value: ALL, label: t('admin.filter.all') },
                  ...(seasons.data ?? []).map((season) => ({
                    value: season.id,
                    label: season.name,
                  })),
                ]}
              />
              <SelectField
                label={t('admin.races.filter.status')}
                value={search.status ?? ALL}
                onChange={(event) => set({ status: select<RaceStatus>(event.target.value) })}
                options={[
                  { value: ALL, label: t('admin.filter.all') },
                  ...RACE_STATUSES.map((value) => ({
                    value,
                    label: t(`admin.races.status.${value}`),
                  })),
                ]}
              />
              <SelectField
                label={t('admin.races.filter.bikeClass')}
                value={search.bikeClass ?? ALL}
                onChange={(event) => set({ bikeClass: select<BikeClass>(event.target.value) })}
                options={[
                  { value: ALL, label: t('admin.filter.all') },
                  ...BIKE_CLASSES.map((value) => ({
                    value,
                    label: t(`domain.bikeClass.${value}`),
                  })),
                ]}
              />
              <ToggleChip
                pressed={search.mine === true}
                onToggle={() => set({ mine: search.mine ? undefined : true })}
              >
                {t('admin.races.filter.mine')}
              </ToggleChip>
            </>
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
