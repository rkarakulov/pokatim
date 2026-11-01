import { describe, expect, it } from 'vitest';

import {
  MySeasonStandings,
  PanelSeasonStandingsSummary,
  PanelSeasonStandingsTable,
  SeasonStandingsSummary,
  SeasonStandingsTable,
  SeasonStandingsTableQuery,
  STANDING_OUTCOMES,
  STANDINGS_PAGE_MAX,
  STANDINGS_PAGE_SIZE,
  STANDINGS_SYNC_STATES,
} from './standings.schema.ts';

const ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const AT = '2026-10-28T10:00:00.000Z';

const cell = { raceId: ID, place: 1, tied: false, outcome: 'placed', points: 100, counted: true };
const row = { order: 0, place: 1, tied: false, riderName: null, points: 100, cells: [cell] };
const table = {
  bikeClass: 'road',
  groupKey: 'm_u40',
  computedAt: AT,
  racesTotal: 1,
  racesCounted: 1,
  riders: 1,
  races: [{ id: ID, title: 'Минское кольцо', windowEndsAt: AT }],
  items: [row],
  nextCursor: null,
};

describe('рейтинг сезона — контракты (race-results-08)', () => {
  it('строка: ссылка на профиль и фото — по правилам имени; старый сервер — null', () => {
    const token = 'A'.repeat(43);
    expect(SeasonStandingsTable.parse(table).items[0]).toMatchObject({
      riderPublicId: null,
      riderAvatar: null,
    });
    const linked = {
      ...row,
      riderName: 'Анна К.',
      riderPublicId: token,
      riderAvatar: { id: token },
    };
    expect(SeasonStandingsTable.parse({ ...table, items: [linked] }).items[0]).toMatchObject({
      riderPublicId: token,
      riderAvatar: { id: token },
    });
    expect(
      SeasonStandingsTable.safeParse({ ...table, items: [{ ...linked, riderAvatar: { id: 'x' } }] })
        .success,
    ).toBe(false);
  });

  it('справочники и пределы страницы', () => {
    expect(STANDING_OUTCOMES).toEqual(['placed', 'dq', 'none']);
    expect(STANDINGS_SYNC_STATES).toEqual(['current', 'pending']);
    expect([STANDINGS_PAGE_SIZE, STANDINGS_PAGE_MAX]).toEqual([50, 100]);
  });

  it('ответы приложения нового сервера: незнакомые класс, группа и итог — unknown', () => {
    const summary = SeasonStandingsSummary.parse({
      seasonId: ID,
      computedAt: null,
      tables: [{ bikeClass: 'cx', groupKey: 'u23', riders: 3, racesTotal: 2, racesCounted: 2 }],
    });
    expect(summary.tables[0]).toMatchObject({ bikeClass: 'unknown', groupKey: 'unknown' });

    const parsed = SeasonStandingsTable.parse({
      ...table,
      bikeClass: 'cx',
      items: [{ ...row, cells: [{ ...cell, outcome: 'dnf' }] }],
    });
    expect(parsed.bikeClass).toBe('unknown');
    expect(parsed.items[0]!.cells[0]!.outcome).toBe('unknown');

    const mine = MySeasonStandings.parse({
      seasonId: ID,
      computedAt: AT,
      races: table.races,
      items: [
        {
          bikeClass: 'road',
          groupKey: 'w_50p',
          order: 3,
          place: 2,
          tied: true,
          points: 85,
          riders: 4,
          racesTotal: 1,
          racesCounted: 1,
          raceIds: [ID],
          cells: [cell],
        },
      ],
    });
    expect(mine.items[0]!.groupKey).toBe('w_50p');
  });

  it('query таблицы: строгий (лишний ключ — ошибка), класс и группа обязательны, limit по умолчанию и пределы', () => {
    expect(SeasonStandingsTableQuery.parse({ bikeClass: 'road', group: 'overall' })).toEqual({
      bikeClass: 'road',
      group: 'overall',
      limit: STANDINGS_PAGE_SIZE,
    });
    expect(
      SeasonStandingsTableQuery.parse({ bikeClass: 'mtb', group: 'm_50p', limit: '100' }).limit,
    ).toBe(100);
    const bad = (query: Record<string, unknown>) =>
      SeasonStandingsTableQuery.safeParse(query).success;
    expect(bad({ bikeClass: 'road', group: 'overall', extra: '1' })).toBe(false);
    // метка обхода HTTP-кэша whatwg-fetch (RN): принимается и отбрасывается; не число — ошибка
    expect(
      SeasonStandingsTableQuery.parse({ bikeClass: 'road', group: 'overall', _: '1761990000000' }),
    ).toEqual({ bikeClass: 'road', group: 'overall', limit: STANDINGS_PAGE_SIZE });
    expect(bad({ bikeClass: 'road', group: 'overall', _: 'x' })).toBe(false);
    expect(bad({ bikeClass: 'road' })).toBe(false);
    expect(bad({ bikeClass: 'cx', group: 'overall' })).toBe(false);
    expect(bad({ bikeClass: 'road', group: 'u23' })).toBe(false);
    expect(bad({ bikeClass: 'road', group: 'overall', limit: '0' })).toBe(false);
    expect(bad({ bikeClass: 'road', group: 'overall', limit: '101' })).toBe(false);
  });

  it('панель: строгие справочники, userId строки и состояние пересчёта', () => {
    const summary = PanelSeasonStandingsSummary.parse({
      seasonId: ID,
      computedAt: AT,
      tables: [],
      formulaVersion: 1,
      sync: 'pending',
    });
    expect(summary.sync).toBe('pending');
    expect(PanelSeasonStandingsSummary.safeParse({ ...summary, sync: 'stale' }).success).toBe(
      false,
    );
    const panelTable = PanelSeasonStandingsTable.parse({
      ...table,
      items: [{ ...row, userId: null }],
    });
    expect(panelTable.items[0]!.userId).toBeNull();
    // неизвестные класс, группа и исход в панели — ошибка, а не `unknown`
    for (const bad of [
      { ...panelTable, bikeClass: 'future-class' },
      { ...panelTable, groupKey: 'future-group' },
      {
        ...panelTable,
        items: [{ ...panelTable.items[0]!, cells: [{ ...row.cells[0]!, outcome: 'future' }] }],
      },
    ]) {
      expect(PanelSeasonStandingsTable.safeParse(bad).success).toBe(false);
    }
    expect(
      PanelSeasonStandingsSummary.safeParse({
        ...summary,
        tables: [
          {
            bikeClass: 'future-class',
            groupKey: 'm_u40',
            riders: 1,
            racesTotal: 1,
            racesCounted: 1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
