import type {
  MySeasonStanding,
  MySeasonStandings,
  SeasonCard,
  SeasonStandingCell,
  SeasonStandingRow,
  SeasonStandingsSummary,
  SeasonStandingsTable,
  SeasonStandingsTableRef,
} from '@pokatim/contracts';

/** Фикстуры рейтинга сезона (race-results-08c) в форме ответов API (контракты 08a). */
export const SEASON_ID = '0190a6f4-0000-7000-8000-000000000026';
export const COMPUTED_AT = '2026-10-20T10:00:00.000Z';
export const NEWER_AT = '2026-10-20T10:01:00.000Z';
export const RACE_1 = '0190a6f4-0000-7000-8000-000000000101';
export const RACE_2 = '0190a6f4-0000-7000-8000-000000000102';
export const RACE_3 = '0190a6f4-0000-7000-8000-000000000103';

export const season2026: SeasonCard = {
  id: SEASON_ID,
  name: 'Сезон 2026',
  startsOn: '2026-04-01',
  endsOn: '2026-10-31',
  phase: 'current',
};

export const tableRef = (
  overrides: Partial<SeasonStandingsTableRef> = {},
): SeasonStandingsTableRef => ({
  bikeClass: 'road',
  groupKey: 'm_u40',
  riders: 3,
  racesTotal: 3,
  racesCounted: 2,
  ...overrides,
});

export const summary = (
  tables: SeasonStandingsTableRef[] = [
    tableRef(),
    tableRef({ groupKey: 'w_u40', riders: 2 }),
    tableRef({
      bikeClass: 'gravel',
      groupKey: 'overall',
      riders: 1,
      racesTotal: 1,
      racesCounted: 1,
    }),
  ],
  computedAt: string | null = COMPUTED_AT,
): SeasonStandingsSummary => ({ seasonId: SEASON_ID, computedAt, tables });

export const cell = (overrides: Partial<SeasonStandingCell> = {}): SeasonStandingCell => ({
  raceId: RACE_1,
  place: 1,
  tied: false,
  outcome: 'placed',
  points: 100,
  counted: true,
  ...overrides,
});

export const standingRow = (overrides: Partial<SeasonStandingRow> = {}): SeasonStandingRow => ({
  order: 0,
  place: 1,
  tied: false,
  riderName: null,
  points: 100,
  cells: [],
  ...overrides,
});

export const standingsTable = (
  items: SeasonStandingRow[],
  overrides: Partial<SeasonStandingsTable> = {},
): SeasonStandingsTable => ({
  bikeClass: 'road',
  groupKey: 'm_u40',
  computedAt: COMPUTED_AT,
  racesTotal: 3,
  racesCounted: 2,
  riders: items.length,
  races: [
    { id: RACE_1, title: 'Гонка 1', windowEndsAt: '2026-05-03T20:59:00.000Z' },
    { id: RACE_2, title: 'Гонка 2', windowEndsAt: '2026-06-03T20:59:00.000Z' },
    { id: RACE_3, title: 'Гонка 3', windowEndsAt: '2026-07-03T20:59:00.000Z' },
  ],
  items,
  nextCursor: null,
  ...overrides,
});

/** Аня, Боря «=1» по 185, Вера 3-я (пример спайка, сокращённо). */
export const menRows = [
  standingRow({ order: 0, place: 1, tied: true, riderName: 'Анна К.', points: 185 }),
  standingRow({ order: 1, place: 1, tied: true, points: 185 }),
  standingRow({ order: 2, place: 3, points: 160 }),
];

export const myStanding = (overrides: Partial<MySeasonStanding> = {}): MySeasonStanding => ({
  bikeClass: 'road',
  groupKey: 'm_u40',
  order: 1,
  place: 1,
  tied: true,
  points: 185,
  riders: 3,
  racesTotal: 3,
  racesCounted: 2,
  raceIds: [RACE_1, RACE_2, RACE_3],
  cells: [
    cell({ raceId: RACE_1, place: 2, points: 85 }),
    cell({ raceId: RACE_2, place: null, outcome: 'dq', points: 0 }),
    cell({ raceId: RACE_3, place: 3, points: 75, counted: false }),
  ],
  ...overrides,
});

export const mine = (
  items: MySeasonStanding[] = [myStanding()],
  computedAt: string | null = COMPUTED_AT,
): MySeasonStandings => ({
  seasonId: SEASON_ID,
  computedAt,
  races: [
    { id: RACE_1, title: 'Гонка 1', windowEndsAt: '2026-05-03T20:59:00.000Z' },
    { id: RACE_2, title: 'Гонка 2', windowEndsAt: '2026-06-03T20:59:00.000Z' },
    { id: RACE_3, title: 'Гонка 3', windowEndsAt: '2026-07-03T20:59:00.000Z' },
  ],
  items,
});
