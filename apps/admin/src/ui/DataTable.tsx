import { t } from '@pokatim/i18n';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { type ReactNode, useMemo, useState } from 'react';

import { Banner } from './Banner';
import { Button } from './Button';
import { EmptyState, ErrorState } from './states';

/** Строк скелетона первой загрузки (раскладка успешного состояния). */
export const SKELETON_ROWS = 8;

/** Состояние данных таблицы: `useQuery` с массивом или собранные страницы `useInfiniteQuery`. */
export interface TableQuery<T> {
  data: T[] | undefined;
  isError: boolean;
  error: unknown;
  /** `paused` — запрос ждёт сети (TanStack Query): без данных это «Нет соединения», а не загрузка. */
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  refetch: () => unknown;
}

export interface DataTableProps<T> {
  // ColumnDef с разными типами значений ячеек — any у TanStack Table по замыслу (accessor value)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  query: TableQuery<T>;
  /** Пусто: данных нет совсем. */
  empty: ReactNode;
  /** Фильтры над таблицей — видны сразу, и на загрузке тоже. */
  toolbar?: ReactNode;
  /** Фильтр строк (поиск, статус) — вычисляется на клиенте поверх загруженного. */
  filter?: (row: T) => boolean;
  /** Ничего не нашлось по фильтрам. */
  noMatches?: ReactNode;
  /** Подпись таблицы для чтения с экрана. */
  caption: string;
  getRowId?: (row: T) => string;
  /** Ошибка без данных: свой экран (например, «Нет доступа к разделу» при 403). */
  renderError?: (error: unknown) => ReactNode | undefined;
  initialSorting?: SortingState;
  footer?: ReactNode;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/**
 * Плотная таблица панели (TanStack Table): фиксированная шапка, сортировка по заголовку (`aria-sort`), фильтры
 * сверху. Состояния — AGENTS.md §4.12: первая загрузка — 8 строк скелетона под видимой шапкой; ошибка без данных —
 * «Нет соединения» / «Не удалось загрузить» с повтором; ошибка обновления — данные остаются, баннер сверху; пусто —
 * `empty`. Кандидат в `admin-kit` (F6).
 */
export function DataTable<T>({
  columns,
  query,
  empty,
  toolbar,
  filter,
  noMatches,
  caption,
  getRowId,
  renderError,
  initialSorting = [],
  footer,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const data = query.data;
  const rows = useMemo(() => (data && filter ? data.filter(filter) : (data ?? [])), [data, filter]);
  // TanStack Table v8 возвращает изменяемый объект таблицы: React Compiler пропускает компонент (так и задумано
  // правилом), предупреждение — информационное
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  const paused = query.fetchStatus === 'paused';
  if (data === undefined && (query.isError || paused)) {
    return (
      <>
        {toolbar ? <div className="toolbar">{toolbar}</div> : null}
        {(query.isError ? renderError?.(query.error) : undefined) ?? (
          <ErrorState error={query.error} offline={paused} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }

  const loading = data === undefined;
  const head = (
    <thead>
      {table.getHeaderGroups().map((group) => (
        <tr key={group.id}>
          {group.headers.map((header) => {
            const sorted = header.column.getIsSorted();
            const label = flexRender(header.column.columnDef.header, header.getContext());
            return (
              <th
                key={header.id}
                scope="col"
                className="t-panel-table-head"
                aria-sort={
                  header.column.getCanSort() ? (sorted ? ARIA_SORT[sorted] : 'none') : undefined
                }
              >
                {header.column.getCanSort() && !loading ? (
                  <button
                    type="button"
                    className="table__sort"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {label}
                    <span aria-hidden="true">
                      {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}
                    </span>
                  </button>
                ) : (
                  label
                )}
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );

  return (
    <>
      {toolbar ? <div className="toolbar">{toolbar}</div> : null}
      {data !== undefined && query.isError ? (
        <Banner
          tone="warning"
          title={t('state.staleTitle')}
          actions={
            <Button size="sm" onClick={() => void query.refetch()}>
              {t('state.retry')}
            </Button>
          }
        >
          {t('state.staleMessage')}
        </Banner>
      ) : null}
      {data !== undefined && data.length === 0 ? (
        empty
      ) : (
        <div className="table-wrap">
          <table className="table t-body" aria-busy={loading}>
            <caption className="visually-hidden">{caption}</caption>
            {head}
            <tbody>
              {loading
                ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <tr key={index} data-testid="skeleton-row">
                      {columns.map((_column, cell) => (
                        <td key={cell}>
                          <span className="skeleton table__skeleton t-body">{' '}</span>
                        </td>
                      ))}
                    </tr>
                  ))
                : table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
          {loading ? (
            <span role="progressbar" aria-label={t('state.loading')} className="visually-hidden" />
          ) : null}
        </div>
      )}
      {!loading && data.length > 0 && rows.length === 0 ? (
        <EmptyState title={noMatches ?? empty} />
      ) : null}
      {footer}
    </>
  );
}
