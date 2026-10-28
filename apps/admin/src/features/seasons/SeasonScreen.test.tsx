// @vitest-environment jsdom
import type {
  PanelSeason,
  PanelSeasonStandingRow,
  PanelSeasonStandingsSummary,
  PanelSeasonStandingsTable,
} from '@pokatim/contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api';
import { httpError, ME, networkError, renderApp } from '../../test/app';
import { seasonStandingsKey } from './standings-query';

vi.mock('../../api', () => ({
  api: {
    me: vi.fn(),
    health: vi.fn(),
    listSeasons: vi.fn(),
    getSeasonStandings: vi.fn(),
    getSeasonStandingsTable: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const SEASON_ID = '01890a5d-ac96-774b-bcce-b302099a8070';
const RACE_A = '01890a5d-ac96-774b-bcce-b302099a8101';
const RACE_B = '01890a5d-ac96-774b-bcce-b302099a8102';
const RACE_C = '01890a5d-ac96-774b-bcce-b302099a8103';
const USER_A = '01890a5d-ac96-774b-bcce-b3020aa1b2c3';
const USER_B = '01890a5d-ac96-774b-bcce-b3020dd4e5f6';
const COMPUTED_AT = '2026-10-25T10:30:00.000Z';

const SEASON: PanelSeason = {
  id: SEASON_ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
  raceCount: 3,
  version: 0,
};

const summary = (
  overrides: Partial<PanelSeasonStandingsSummary> = {},
): PanelSeasonStandingsSummary => ({
  seasonId: SEASON_ID,
  computedAt: COMPUTED_AT,
  formulaVersion: 1,
  sync: 'current',
  tables: [
    { bikeClass: 'road', groupKey: 'm_u40', riders: 2, racesTotal: 3, racesCounted: 2 },
    { bikeClass: 'road', groupKey: 'w_u40', riders: 1, racesTotal: 3, racesCounted: 2 },
    { bikeClass: 'gravel', groupKey: 'overall', riders: 1, racesTotal: 1, racesCounted: 1 },
  ],
  ...overrides,
});

const row = (overrides: Partial<PanelSeasonStandingRow>): PanelSeasonStandingRow => ({
  order: 0,
  place: 1,
  tied: false,
  riderName: 'Анна К.',
  userId: USER_A,
  points: 185,
  cells: [],
  ...overrides,
});

const RACES = [
  { id: RACE_A, title: 'Гонка А', windowEndsAt: '2026-05-10T20:59:00.000Z' },
  { id: RACE_B, title: 'Гонка Б', windowEndsAt: '2026-06-10T20:59:00.000Z' },
  { id: RACE_C, title: 'Гонка В', windowEndsAt: '2026-07-10T20:59:00.000Z' },
];

const table = (overrides: Partial<PanelSeasonStandingsTable> = {}): PanelSeasonStandingsTable => ({
  bikeClass: 'road',
  groupKey: 'm_u40',
  computedAt: COMPUTED_AT,
  racesTotal: 3,
  racesCounted: 2,
  riders: 2,
  races: RACES,
  items: [
    row({
      cells: [
        { raceId: RACE_A, place: 1, tied: false, outcome: 'placed', points: 100, counted: true },
        { raceId: RACE_B, place: 2, tied: true, outcome: 'placed', points: 85, counted: true },
        { raceId: RACE_C, place: 5, tied: false, outcome: 'placed', points: 60, counted: false },
      ],
    }),
    row({
      order: 1,
      place: 2,
      riderName: null,
      userId: USER_B,
      points: 75,
      cells: [
        { raceId: RACE_A, place: null, tied: false, outcome: 'dq', points: 0, counted: true },
        { raceId: RACE_B, place: 3, tied: false, outcome: 'placed', points: 75, counted: true },
        { raceId: RACE_C, place: null, tied: false, outcome: 'none', points: 0, counted: false },
      ],
    }),
  ],
  nextCursor: null,
  ...overrides,
});

beforeEach(() => {
  mocked.me.mockResolvedValue(ME.admin);
  mocked.listSeasons.mockResolvedValue({ items: [SEASON] });
  mocked.getSeasonStandings.mockResolvedValue(summary());
  mocked.getSeasonStandingsTable.mockResolvedValue(table());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const PATH = `/seasons/${SEASON_ID}`;
const rating = () => screen.getByRole('region', { name: 'Рейтинг' });
const cellsOf = (name: string) =>
  within(screen.getByRole('cell', { name }).closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

describe('Сезон: «Рейтинг» (08b)', () => {
  it('шапка — название и даты сезона, крошка «Сезоны»; время пересчёта, формула и «Актуален»', async () => {
    await renderApp(PATH);
    expect(await screen.findByRole('heading', { name: 'Сезон 2026', level: 1 })).toBeTruthy();
    expect(screen.getByText('1 апреля 2026 — 31 октября 2026')).toBeTruthy();
    // крошка шапки (вторая ссылка «Сезоны» — пункт навигации)
    expect(
      screen
        .getAllByRole('link', { name: 'Сезоны' })
        .some((link) => link.closest('.page-head') !== null),
    ).toBe(true);
    expect(await within(rating()).findByText('Пересчёт: 25 октября 2026, 13:30')).toBeTruthy();
    expect(within(rating()).getByText('Формула v1')).toBeTruthy();
    expect(within(rating()).getByText('Актуален')).toBeTruthy();
    expect(mocked.getSeasonStandings).toHaveBeenCalledWith(SEASON_ID);
  });

  it('переключатели — только классы и группы из сводки; таблица открыта на первой', async () => {
    await renderApp(PATH);
    const classes = await screen.findByRole('group', { name: 'Класс' });
    expect(
      within(classes)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Шоссе', 'Гравий']);
    expect(
      within(classes).getByRole('button', { name: 'Шоссе' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const groups = screen.getByRole('group', { name: 'Группа' });
    expect(
      within(groups)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Мужчины до 40', 'Женщины до 40']);
    await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' });
    expect(mocked.getSeasonStandingsTable).toHaveBeenCalledWith(SEASON_ID, {
      bikeClass: 'road',
      group: 'm_u40',
    });
    expect(
      screen.getByText('Мужчины до 40 · Шоссе · 3 гонки, в зачёте 2 · 2 участника'),
    ).toBeTruthy();

    fireEvent.click(within(groups).getByRole('button', { name: 'Женщины до 40' }));
    await waitFor(() =>
      expect(mocked.getSeasonStandingsTable).toHaveBeenLastCalledWith(SEASON_ID, {
        bikeClass: 'road',
        group: 'w_u40',
      }),
    );

    fireEvent.click(within(classes).getByRole('button', { name: 'Гравий' }));
    await waitFor(() =>
      expect(mocked.getSeasonStandingsTable).toHaveBeenLastCalledWith(SEASON_ID, {
        bikeClass: 'gravel',
        group: 'overall',
      }),
    );
    expect(
      within(screen.getByRole('group', { name: 'Группа' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Общий зачёт']);
  });

  it('строки: место «=N», участник, очки; ячейки гонок — «1 · 100», «=2 · 85», «DQ · 0», «—»; не в зачёте — приглушена', async () => {
    await renderApp(PATH);
    await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' });
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Место',
      'Участник',
      'Очки',
      'Гонка А',
      'Гонка Б',
      'Гонка В',
    ]);
    expect(cellsOf('Анна К. ·a1b2c3')).toEqual([
      '1',
      'Анна К. ·a1b2c3',
      '185',
      '1 · 100',
      '=2 · 85',
      '5 · 60, не в зачёте',
    ]);
    expect(cellsOf('Участник ·d4e5f6')).toEqual([
      '2',
      'Участник ·d4e5f6',
      '75',
      'DQ · 0',
      '3 · 75',
      '—',
    ]);
    const notCounted = screen.getByText('5 · 60');
    expect(notCounted.className).toContain('muted');
    expect(screen.getByText(', не в зачёте').className).toContain('visually-hidden');
  });

  it('ничья в сезоне — место «=1»', async () => {
    mocked.getSeasonStandingsTable.mockResolvedValue(
      table({
        items: [
          row({ tied: true }),
          row({ order: 1, tied: true, riderName: 'Боря', userId: USER_B }),
        ],
      }),
    );
    await renderApp(PATH);
    await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' });
    expect(cellsOf('Анна К. ·a1b2c3')[0]).toBe('=1');
    expect(cellsOf('Боря ·d4e5f6')[0]).toBe('=1');
  });

  it('организатор (userId: null) — «Участник» без id, имя — без id', async () => {
    mocked.me.mockResolvedValue(ME.organizer);
    mocked.getSeasonStandingsTable.mockResolvedValue(
      table({
        items: [row({ userId: null }), row({ order: 1, place: 2, userId: null, riderName: null })],
      }),
    );
    await renderApp(PATH);
    expect(await screen.findByRole('cell', { name: 'Анна К.' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Участник' })).toBeTruthy();
    expect(screen.queryByRole('cell', { name: /·[0-9a-f]{6}$/ })).toBeNull();
  });

  it('«Ждёт пересчёта»', async () => {
    mocked.getSeasonStandings.mockResolvedValue(summary({ sync: 'pending' }));
    await renderApp(PATH);
    expect(await screen.findByText('Ждёт пересчёта')).toBeTruthy();
  });

  it('пусто: таблиц нет — пустое состояние с подсказкой, «Ждёт пересчёта», без переключателей', async () => {
    mocked.getSeasonStandings.mockResolvedValue(
      summary({ computedAt: null, formulaVersion: null, sync: 'pending', tables: [] }),
    );
    await renderApp(PATH);
    expect(await screen.findByText('Таблиц сезона пока нет')).toBeTruthy();
    expect(screen.getByText(/появятся после публикации первого протокола/)).toBeTruthy();
    expect(screen.getByText('Ждёт пересчёта')).toBeTruthy();
    expect(screen.getByText('Пересчёта ещё не было')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Класс' })).toBeNull();
    expect(mocked.getSeasonStandingsTable).not.toHaveBeenCalled();
  });

  it('таблица не из снимка (RC-12) — пустое состояние', async () => {
    mocked.getSeasonStandingsTable.mockResolvedValue(
      table({ riders: 0, racesTotal: 0, racesCounted: 0, races: [], items: [] }),
    );
    await renderApp(PATH);
    expect(await screen.findByText('В таблице пока нет участников')).toBeTruthy();
    expect(screen.queryByText('Таблиц сезона пока нет')).toBeNull();
    expect(
      screen.getByText('Мужчины до 40 · Шоссе · 0 гонок, в зачёте 0 · 0 участников'),
    ).toBeTruthy();
  });

  it('подпись таблицы — из ответа таблицы, не из сводки; плюрали', async () => {
    mocked.getSeasonStandingsTable.mockResolvedValue(
      table({ racesTotal: 1, racesCounted: 1, riders: 5, races: RACES.slice(0, 1) }),
    );
    await renderApp(PATH);
    expect(
      await screen.findByText('Мужчины до 40 · Шоссе · 1 гонка, в зачёте 1 · 5 участников'),
    ).toBeTruthy();
  });

  it('загрузка — скелетон сводки и таблицы', async () => {
    mocked.getSeasonStandings.mockReturnValue(new Promise(() => undefined));
    await renderApp(PATH);
    await screen.findByRole('heading', { name: 'Сезон 2026', level: 1 });
    expect(within(rating()).getAllByTestId('skeleton-row')).toHaveLength(8);
    expect(within(rating()).getByRole('progressbar')).toBeTruthy();
  });

  it('загрузка таблицы — переключатели видны, строки — скелетон', async () => {
    mocked.getSeasonStandingsTable.mockReturnValue(new Promise(() => undefined));
    await renderApp(PATH);
    expect(await screen.findByRole('group', { name: 'Класс' })).toBeTruthy();
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(8);
  });

  it('ошибка сводки — «Не удалось загрузить» с повтором', async () => {
    mocked.getSeasonStandings.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp(PATH);
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' })).toBeTruthy();
    expect(mocked.getSeasonStandings).toHaveBeenCalledTimes(2);
  });

  it('ошибка таблицы — «Не удалось загрузить» с повтором', async () => {
    mocked.getSeasonStandingsTable.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp(PATH);
    expect(await screen.findByText('Не удалось загрузить')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' })).toBeTruthy();
  });

  it('неизвестный сезон (404) — «Сезон не найден»', async () => {
    mocked.listSeasons.mockResolvedValue({ items: [] });
    mocked.getSeasonStandings.mockRejectedValue(httpError(404, 'NOT_FOUND'));
    await renderApp(PATH);
    expect(await screen.findByText('Сезон не найден')).toBeTruthy();
  });

  it('«Показать ещё» — следующая страница по курсору', async () => {
    mocked.getSeasonStandingsTable
      .mockResolvedValueOnce(table({ items: [row({})], nextCursor: 'c1' }))
      .mockResolvedValueOnce(
        table({ items: [row({ order: 1, place: 2, riderName: 'Боря', userId: USER_B })] }),
      );
    await renderApp(PATH);
    await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' });
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByRole('cell', { name: 'Боря ·d4e5f6' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Анна К. ·a1b2c3' })).toBeTruthy();
    expect(mocked.getSeasonStandingsTable).toHaveBeenLastCalledWith(SEASON_ID, {
      bikeClass: 'road',
      group: 'm_u40',
      cursor: 'c1',
    });
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
  });

  it('курсор и снимок: другая `computedAt` следующей страницы — таблица заново с первой страницы', async () => {
    const NEWER = '2026-10-25T10:31:00.000Z';
    mocked.getSeasonStandingsTable
      .mockResolvedValueOnce(table({ items: [row({})], nextCursor: 'c1' }))
      .mockResolvedValueOnce(
        table({
          computedAt: NEWER,
          items: [row({ order: 1, place: 2, riderName: 'Боря', userId: USER_B })],
        }),
      )
      .mockResolvedValueOnce(
        table({
          computedAt: NEWER,
          items: [row({ riderName: 'Вера', userId: USER_B }), row({ order: 1, place: 2 })],
        }),
      );
    await renderApp(PATH);
    await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' });
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByRole('cell', { name: 'Вера ·d4e5f6' })).toBeTruthy();
    expect(screen.queryByRole('cell', { name: 'Боря ·d4e5f6' })).toBeNull();
    expect(mocked.getSeasonStandingsTable).toHaveBeenLastCalledWith(SEASON_ID, {
      bikeClass: 'road',
      group: 'm_u40',
    });
    expect(mocked.getSeasonStandingsTable).toHaveBeenCalledTimes(3);
  });

  it('ошибка обновления сводки — данные остаются, баннер с повтором', async () => {
    mocked.getSeasonStandings
      .mockResolvedValueOnce(summary())
      .mockRejectedValueOnce(httpError(500, 'INTERNAL'))
      .mockResolvedValueOnce(summary({ sync: 'pending' }));
    // смена снимка между страницами инвалидирует сводку — её обновление падает
    mocked.getSeasonStandingsTable
      .mockResolvedValueOnce(table({ items: [row({})], nextCursor: 'c1' }))
      .mockResolvedValue(table({ computedAt: '2026-10-25T10:31:00.000Z' }));
    await renderApp(PATH);
    await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' });
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));

    const banner = await screen.findByRole('alert');
    expect(within(banner).getByText('Не удалось обновить рейтинг')).toBeTruthy();
    expect(screen.getByText('Актуален')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Ждёт пересчёта')).toBeTruthy();
    expect(screen.queryByText('Не удалось обновить рейтинг')).toBeNull();
  });

  it('шапка: пока грузятся сезоны — скелетон заголовка, рейтинг уже виден', async () => {
    mocked.listSeasons.mockReturnValue(new Promise(() => undefined));
    await renderApp(PATH);
    expect(await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' })).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.querySelector('.skeleton')).not.toBeNull();
    expect(heading.textContent?.trim()).toBe('');
  });

  it('шапка: ошибка загрузки сезонов — баннер с повтором, рейтинг показан', async () => {
    mocked.listSeasons.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await renderApp(PATH);
    expect(await screen.findByText('Не удалось загрузить название и даты сезона')).toBeTruthy();
    expect(await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' })).toBeTruthy();
    const banner = screen
      .getByText('Не удалось загрузить название и даты сезона')
      .closest('.banner')!;
    fireEvent.click(within(banner as HTMLElement).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Сезон 2026', level: 1 })).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить название и даты сезона')).toBeNull();
  });

  it('403 — «Нет доступа к разделу»', async () => {
    mocked.getSeasonStandings.mockRejectedValue(httpError(403, 'FORBIDDEN'));
    await renderApp(PATH);
    expect(await screen.findByRole('heading', { name: 'Нет доступа к разделу' })).toBeTruthy();
  });

  it('шапка: сезоны ждут сети (paused) — «Нет соединения» с повтором, рейтинг из кэша виден', async () => {
    onlineManager.setOnline(false);
    try {
      const { queryClient } = await renderApp(PATH);
      act(() => {
        queryClient.setQueryData(seasonStandingsKey(SEASON_ID), summary());
        queryClient.setQueryData([...seasonStandingsKey(SEASON_ID), 'table', 'road', 'm_u40'], {
          pages: [table()],
          pageParams: [undefined],
        });
      });
      expect(await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' })).toBeTruthy();
      const banner = screen.getByText('Нет соединения').closest('.banner')!;
      expect(within(banner as HTMLElement).getByRole('button', { name: 'Повторить' })).toBeTruthy();
      expect(mocked.listSeasons).not.toHaveBeenCalled();
    } finally {
      act(() => onlineManager.setOnline(true));
    }
    expect(await screen.findByRole('heading', { name: 'Сезон 2026', level: 1 })).toBeTruthy();
    expect(screen.queryByText('Нет соединения')).toBeNull();
  });

  it('шапка: сетевой отказ сезонов — «Нет соединения» с повтором, рейтинг виден', async () => {
    mocked.listSeasons.mockRejectedValueOnce(networkError());
    await renderApp(PATH);
    expect(await screen.findByRole('cell', { name: 'Анна К. ·a1b2c3' })).toBeTruthy();
    const banner = (await screen.findByText('Нет соединения')).closest('.banner')!;
    fireEvent.click(within(banner as HTMLElement).getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Сезон 2026', level: 1 })).toBeTruthy();
  });

  it('шапка: фоновое обновление сезонов упало при показанных данных — без баннера шапки', async () => {
    const { queryClient } = await renderApp(PATH);
    await screen.findByRole('heading', { name: 'Сезон 2026', level: 1 });
    mocked.listSeasons.mockRejectedValueOnce(httpError(500, 'INTERNAL'));
    await act(() => queryClient.refetchQueries({ queryKey: ['admin', 'seasons'], exact: true }));
    expect(queryClient.getQueryState(['admin', 'seasons'])?.status).toBe('error');
    expect(screen.getByRole('heading', { name: 'Сезон 2026', level: 1 })).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить название и даты сезона')).toBeNull();
  });
});
