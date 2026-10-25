// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpError, networkError } from '../test/app';
import { DataTable, SKELETON_ROWS } from './DataTable';

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

interface Row {
  id: string;
  name: string;
  status: string;
}

const columns: ColumnDef<Row, string>[] = [
  { accessorKey: 'name', header: 'Имя' },
  { accessorKey: 'status', header: 'Статус', enableSorting: false },
];

const ROWS: Row[] = [
  { id: '1', name: 'Борис', status: 'active' },
  { id: '2', name: 'Анна', status: 'revoked' },
  { id: '3', name: 'Вера', status: 'active' },
];

function Table({ load, filter }: { load: () => Promise<Row[]>; filter?: (row: Row) => boolean }) {
  const query = useQuery({ queryKey: ['rows'], queryFn: load, retry: false });
  return (
    <DataTable
      caption="Строки"
      columns={columns}
      query={query}
      empty={<p>Строк нет</p>}
      noMatches="Ничего не нашли"
      toolbar={<label>Фильтр</label>}
      filter={filter}
      getRowId={(row) => row.id}
    />
  );
}

function renderTable(load: () => Promise<Row[]>, filter?: (row: Row) => boolean) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Table load={load} filter={filter} />
    </QueryClientProvider>,
  );
  return client;
}

const bodyRows = () =>
  within(screen.getByRole('table')).getAllByRole('row').slice(1) as HTMLTableRowElement[];

describe('DataTable (AGENTS.md §4.12, AC11)', () => {
  it('первая загрузка — 8 строк скелетона под видимой шапкой и фильтрами', () => {
    renderTable(() => new Promise(() => undefined));
    expect(screen.getByText('Фильтр')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Имя' })).toBeTruthy();
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(SKELETON_ROWS);
    expect(screen.getByRole('progressbar', { name: 'Загрузка' })).toBeTruthy();
  });

  it('сортировка по заголовку: aria-sort none → ascending → descending', async () => {
    renderTable(() => Promise.resolve(ROWS));
    await screen.findByText('Анна');
    const header = screen.getByRole('columnheader', { name: /Имя/ });
    expect(header.getAttribute('aria-sort')).toBe('none');
    expect(
      screen.getByRole('columnheader', { name: 'Статус' }).getAttribute('aria-sort'),
    ).toBeNull();

    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(bodyRows().map((row) => row.cells[0]?.textContent)).toEqual(['Анна', 'Борис', 'Вера']);

    fireEvent.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(bodyRows().map((row) => row.cells[0]?.textContent)).toEqual(['Вера', 'Борис', 'Анна']);
  });

  it('фильтр — только подходящие строки; ничего — «Ничего не нашли»', async () => {
    renderTable(
      () => Promise.resolve(ROWS),
      (row) => row.status === 'active',
    );
    await screen.findByText('Борис');
    expect(bodyRows()).toHaveLength(2);
    cleanup();
    renderTable(
      () => Promise.resolve(ROWS),
      () => false,
    );
    expect(await screen.findByText('Ничего не нашли')).toBeTruthy();
  });

  it('пусто — пустое состояние экрана', async () => {
    renderTable(() => Promise.resolve([]));
    expect(await screen.findByText('Строк нет')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('ошибка без данных: сеть — «Нет соединения», сервер — «Не удалось загрузить»; «Повторить» перезапрашивает', async () => {
    const load = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ROWS);
    renderTable(load);
    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Анна')).toBeTruthy();

    cleanup();
    renderTable(() => Promise.reject(httpError(500, 'INTERNAL')));
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
  });

  it('нет сети до первой загрузки (запрос на паузе) — «Нет соединения» с повтором, фильтры видны; сеть вернулась — данные', async () => {
    onlineManager.setOnline(false);
    const load = vi.fn().mockResolvedValue(ROWS);
    renderTable(load);

    expect(await screen.findByText('Нет соединения')).toBeTruthy();
    expect(screen.getByText('Фильтр')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryAllByTestId('skeleton-row')).toHaveLength(0);
    expect(load).not.toHaveBeenCalled();

    onlineManager.setOnline(true);
    expect(await screen.findByText('Анна')).toBeTruthy();
  });

  it('ошибка обновления при показанных данных — данные остаются, сверху баннер с повтором', async () => {
    const load = vi.fn().mockResolvedValueOnce(ROWS).mockRejectedValue(networkError());
    const client = renderTable(load);
    await screen.findByText('Анна');
    await client.refetchQueries({ queryKey: ['rows'] }).catch(() => undefined);

    await waitFor(() => expect(screen.getByText('Данные могли устареть')).toBeTruthy());
    expect(screen.getByText('Анна')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
