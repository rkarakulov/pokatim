import type { BikeClass, GroupScheme, ResultGroupKey } from '@pokatim/contracts';
import { describe, expect, it } from 'vitest';

import type { StandingsSourceRow } from '../results';
import {
  buildSeasonStandings,
  pointsForPlace,
  racesCounted,
  type SeasonTable,
  sourceFingerprint,
  sourceVersion,
  STANDINGS_FORMULA_VERSION,
  type StandingsRaceInput,
} from './standings.policy';

const at = (day: number) => new Date(Date.UTC(2026, 5, day, 12));

let seq = 0;
/** Гонка сезона с протоколом; по умолчанию — шоссе, схема пол × возраст, ревизия 1. */
function race(
  rows: StandingsSourceRow[],
  {
    bikeClass = 'road',
    groupScheme = 'gender_age',
    day,
    revision = 1,
    id,
  }: {
    bikeClass?: BikeClass;
    groupScheme?: GroupScheme;
    day?: number;
    revision?: number;
    id?: string;
  } = {},
): StandingsRaceInput {
  seq += 1;
  const n = day ?? seq;
  return {
    id: id ?? `race-${String(n).padStart(2, '0')}`,
    seasonId: 'season',
    bikeClass,
    groupScheme,
    title: `Гонка ${n}`,
    windowEndsAt: at(n),
    revision,
    rows,
  };
}

const placed = (
  userId: string,
  place: number,
  { tied = false, groupKey = 'm_u40' as ResultGroupKey } = {},
): StandingsSourceRow => ({ userId, place, tied, status: 'final', groupKey });
const dq = (userId: string, groupKey: ResultGroupKey = 'm_u40'): StandingsSourceRow => ({
  userId,
  place: null,
  tied: false,
  status: 'dq',
  groupKey,
});

const tableOf = (tables: SeasonTable[], bikeClass: BikeClass, groupKey: ResultGroupKey) =>
  tables.find((table) => table.bikeClass === bikeClass && table.groupKey === groupKey);

const summary = (table: SeasonTable | undefined) =>
  table?.rows.map((row) => [row.userId, row.place, row.tied, row.points]);

describe('очки за место (Ф1, S9, AC2)', () => {
  it('1…10 — таблица, далее −2 за место, 29-е и ниже — 1', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(pointsForPlace)).toEqual([
      100, 85, 75, 67, 60, 54, 49, 45, 41, 38,
    ]);
    expect([11, 12, 27, 28, 29, 30, 100].map(pointsForPlace)).toEqual([36, 34, 4, 2, 1, 1, 1]);
  });

  it('ничья «=2» — каждому очки 2-го места', () => {
    const tables = buildSeasonStandings([
      race([placed('a', 1), placed('b', 2, { tied: true }), placed('c', 2, { tied: true })]),
    ]);
    expect(tableOf(tables, 'road', 'm_u40')!.rows.map((row) => row.cells[0]!.points)).toEqual([
      100, 85, 85,
    ]);
  });
});

describe('N из M (S10, AC3)', () => {
  it('N = M − ⌊M/3⌋', () => {
    expect([0, 1, 2, 3, 5, 6, 8, 9].map(racesCounted)).toEqual([0, 1, 2, 2, 4, 4, 6, 6]);
  });
});

describe('golden — пример спайка §4.1 (AC1)', () => {
  it('Аня/Боря/Вера «=1» по 185, Гена 4-й — 160, Дима 5-й — 75 (DQ не выброшен)', () => {
    // Г3 отменена — протокола нет, во вход не попадает; Г4: Аня dns, Боря — нет
    const g1 = race(
      [
        placed('anya', 1),
        placed('borya', 2, { tied: true }),
        placed('vera', 2, { tied: true }),
        placed('gena', 4),
        placed('dima', 5),
      ],
      { id: 'g1', day: 1 },
    );
    const g2 = race(
      [placed('borya', 1), placed('anya', 2), placed('gena', 3), placed('vera', 4), dq('dima')],
      { id: 'g2', day: 2 },
    );
    const g4 = race([placed('vera', 1), placed('gena', 2), placed('dima', 3)], {
      id: 'g4',
      day: 4,
    });
    const tables = buildSeasonStandings([g4, g1, g2]);
    expect(tables).toHaveLength(1);
    const table = tableOf(tables, 'road', 'm_u40')!;
    expect([table.raceIds, table.racesTotal, table.racesCounted]).toEqual([
      ['g1', 'g2', 'g4'],
      3,
      2,
    ]);
    expect(summary(table)).toEqual([
      ['anya', 1, true, 185],
      ['borya', 1, true, 185],
      ['vera', 1, true, 185],
      ['gena', 4, false, 160],
      ['dima', 5, false, 75],
    ]);
    expect(table.rows.map((row) => row.order)).toEqual([0, 1, 2, 3, 4]);
    const dima = table.rows[4]!;
    expect(dima.cells).toEqual([
      { raceId: 'g1', place: 5, tied: false, outcome: 'placed', points: 60, counted: false },
      { raceId: 'g2', place: null, tied: false, outcome: 'dq', points: 0, counted: true },
      { raceId: 'g4', place: 3, tied: false, outcome: 'placed', points: 75, counted: true },
    ]);
    const anya = table.rows[0]!;
    expect(anya.cells.map((cell) => [cell.outcome, cell.counted])).toEqual([
      ['placed', true],
      ['placed', true],
      ['none', false],
    ]);
  });
});

describe('DQ и пропуски (S11, AC4)', () => {
  it('M = 3: DQ занимает слот; два DQ при N = 2 → сумма 0; dns выбрасывается', () => {
    const tables = buildSeasonStandings([
      race([placed('one-dq', 1), dq('two-dq'), placed('dns', 1)], { day: 1 }),
      race([dq('one-dq'), dq('two-dq')], { day: 2 }),
      race([placed('one-dq', 2), placed('two-dq', 1), placed('dns', 1)], { day: 3 }),
    ]);
    const table = tableOf(tables, 'road', 'm_u40')!;
    const points = Object.fromEntries(table.rows.map((row) => [row.userId, row.points]));
    // DQ (0) + лучшее из 100/85
    expect(points['one-dq']).toBe(100);
    // два DQ заняли оба слота
    expect(points['two-dq']).toBe(0);
    // пропуск (нет строки) выброшен: 100 + 100
    expect(points['dns']).toBe(200);
    const twoDq = table.rows.find((row) => row.userId === 'two-dq')!;
    expect(twoDq.cells.map((cell) => [cell.outcome, cell.counted])).toEqual([
      ['dq', true],
      ['dq', true],
      ['placed', false],
    ]);
  });

  it('лишние DQ сверх N — не в зачёте (сумма та же); «нет строки» никогда не в зачёте', () => {
    const tables = buildSeasonStandings([
      race([dq('x'), placed('y', 1)], { day: 1 }),
      race([dq('x'), placed('y', 1)], { day: 2 }),
      race([dq('x')], { day: 3 }),
    ]);
    const table = tableOf(tables, 'road', 'm_u40')!;
    const x = table.rows.find((row) => row.userId === 'x')!;
    expect(x.cells.map((cell) => cell.counted)).toEqual([true, true, false]);
    const y = table.rows.find((row) => row.userId === 'y')!;
    expect(y.cells.map((cell) => [cell.outcome, cell.counted])).toEqual([
      ['placed', true],
      ['placed', true],
      ['none', false],
    ]);
  });

  it('в таблице и тот, у кого только DQ (0 очков)', () => {
    const tables = buildSeasonStandings([race([placed('a', 1), dq('b')])]);
    expect(summary(tableOf(tables, 'road', 'm_u40'))).toEqual([
      ['a', 1, false, 100],
      ['b', 2, false, 0],
    ]);
  });
});

describe('ничья в сезоне (S12, AC5)', () => {
  it('равные суммы разбиваются по лучшим местам засчитанных гонок', () => {
    // d: 1-е + 8-е = 100 + 45 = 145; e: 2-е + 5-е = 85 + 60 = 145 → у d есть 1-е место — d выше
    const tables = buildSeasonStandings([
      race([placed('d', 1), placed('e', 2)], { day: 1 }),
      race([placed('e', 5), placed('d', 8)], { day: 2 }),
    ]);
    expect(summary(tableOf(tables, 'road', 'm_u40'))).toEqual([
      ['d', 1, false, 145],
      ['e', 2, false, 145],
    ]);
  });

  it('не разбилась — общее «=N», следующее место — N + число равных', () => {
    const tables = buildSeasonStandings([
      race([placed('q', 1), placed('r', 2), placed('s', 3), placed('t', 4)], { day: 1 }),
      race([placed('r', 1), placed('q', 2), placed('t', 3), placed('s', 4)], { day: 2 }),
    ]);
    // q: 100 + 85 = 185, r: 85 + 100 = 185 — ключи [1, 2] равны → «=1»; s: 75 + 67 = 142, t: 67 + 75 = 142 → «=3»
    expect(summary(tableOf(tables, 'road', 'm_u40'))).toEqual([
      ['q', 1, true, 185],
      ['r', 1, true, 185],
      ['s', 3, true, 142],
      ['t', 3, true, 142],
    ]);
  });

  it('RC-10: места 29 и 35 при равных очках — засчитана 29-я (лучшее место), разбивка по ней', () => {
    // M = 3, N = 2: у a — 1-е, 29-е и 35-е (100, 1, 1) → засчитаны 1-е и 29-е
    const tables = buildSeasonStandings([
      race([placed('a', 35)], { day: 1 }),
      race([placed('a', 29)], { day: 2 }),
      race([placed('a', 1)], { day: 3 }),
    ]);
    const a = tableOf(tables, 'road', 'm_u40')!.rows[0]!;
    expect(a.points).toBe(101);
    expect(a.cells.map((cell) => [cell.place, cell.counted])).toEqual([
      [35, false],
      [29, true],
      [1, true],
    ]);
  });
});

describe('разделение таблиц: класс × группа (S13, AC6)', () => {
  it('гонка overall → таблица overall; чужой класс не в M; гонка без строк группы — в M группы', () => {
    const tables = buildSeasonStandings([
      race([placed('a', 1, { groupKey: 'overall' })], { groupScheme: 'overall', day: 1 }),
      race([placed('a', 1), placed('w', 1, { groupKey: 'w_u40' })], { day: 2 }),
      // гонка пол × возраст без строк m_u40 — всё равно входит в M m_u40
      race([placed('w', 2, { groupKey: 'w_u40' })], { day: 3 }),
      race([placed('a', 1)], { bikeClass: 'gravel', day: 4 }),
    ]);
    expect(
      tables.map((table) => [
        table.bikeClass,
        table.groupKey,
        table.racesTotal,
        table.racesCounted,
      ]),
    ).toEqual([
      ['road', 'overall', 1, 1],
      ['road', 'm_u40', 2, 2],
      ['road', 'w_u40', 2, 2],
      ['gravel', 'm_u40', 1, 1],
    ]);
    const mU40 = tableOf(tables, 'road', 'm_u40')!;
    expect(mU40.rows[0]!.cells.map((cell) => cell.outcome)).toEqual(['placed', 'none']);
  });

  it('RC-2: гонка с протоколом без строк (схема gender_age) входит в M групп класса, таблиц без строк нет', () => {
    const tables = buildSeasonStandings([race([], { day: 1 }), race([placed('a', 1)], { day: 2 })]);
    expect(tables.map((table) => [table.groupKey, table.racesTotal])).toEqual([['m_u40', 2]]);
    expect(buildSeasonStandings([race([], { day: 3 })])).toEqual([]);
  });
});

describe('отпечаток и версия источника (RC-5, RC-13)', () => {
  const inputs = [
    { id: 'r1', revision: 1, bikeClass: 'road', groupScheme: 'gender_age' },
    { id: 'r2', revision: 3, bikeClass: 'mtb', groupScheme: 'overall' },
  ] as const;

  it('не зависит от порядка входа, меняется с ревизией, классом, схемой и formulaVersion', () => {
    const base = sourceFingerprint(inputs);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceFingerprint([...inputs].reverse())).toBe(base);
    expect(sourceFingerprint([inputs[0], { ...inputs[1], revision: 4 }])).not.toBe(base);
    expect(sourceFingerprint([inputs[0], { ...inputs[1], bikeClass: 'tt' }])).not.toBe(base);
    expect(sourceFingerprint([inputs[0], { ...inputs[1], groupScheme: 'gender_age' }])).not.toBe(
      base,
    );
    expect(sourceFingerprint(inputs, STANDINGS_FORMULA_VERSION + 1)).not.toBe(base);
  });

  it('sourceVersion — сумма текущих ревизий', () => {
    expect(sourceVersion(inputs)).toBe(4);
    expect(sourceVersion([])).toBe(0);
  });
});
