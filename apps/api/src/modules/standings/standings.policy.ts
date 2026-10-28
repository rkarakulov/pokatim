import { createHash } from 'node:crypto';

import {
  BIKE_CLASSES,
  type BikeClass,
  type GroupScheme,
  RESULT_GROUP_KEYS,
  type ResultGroupKey,
  type StandingOutcome,
} from '@pokatim/contracts';

import type { SeasonRaceForStandings } from '../races';
import type { StandingsSourceRow } from '../results';

/**
 * Правила зачёта сезона (race-results-08, S9–S13) — чистые функции; сервер — единственный источник очков, N из M,
 * мест и ничьих. Смена правил — новая `STANDINGS_FORMULA_VERSION`: регламент пересчитает все сезоны.
 */
export const STANDINGS_FORMULA_VERSION = 1;

const TOP_POINTS = [100, 85, 75, 67, 60, 54, 49, 45, 41, 38] as const;

/** Ф1: 1…10 — таблица; далее −2 за место (11 → 36 … 28 → 2); 29-е и ниже → 1. */
export function pointsForPlace(place: number): number {
  return place <= 10 ? TOP_POINTS[place - 1]! : Math.max(1, 38 - 2 * (place - 10));
}

/** N = M − ⌊M/3⌋ (M = 0 → 0). */
export const racesCounted = (m: number): number => m - Math.floor(m / 3);

const GENDER_AGE_GROUPS = RESULT_GROUP_KEYS.filter((key) => key !== 'overall');

/** Группы, которые даёт схема: `overall` → `overall`, `gender_age` → шесть групп пол × возраст. */
export function schemeGroups(scheme: GroupScheme): readonly ResultGroupKey[] {
  return scheme === 'overall' ? ['overall'] : GENDER_AGE_GROUPS;
}

export interface StandingsRaceInput extends SeasonRaceForStandings {
  revision: number;
  rows: StandingsSourceRow[];
}

export interface StandingCell {
  raceId: string;
  place: number | null;
  tied: boolean;
  outcome: StandingOutcome;
  points: number;
  counted: boolean;
}

export interface StandingRow {
  userId: string;
  order: number;
  place: number;
  tied: boolean;
  points: number;
  cells: StandingCell[];
}

export interface SeasonTable {
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
  /** гонки таблицы по `(windowEndsAt, id)` — порядок ячеек */
  raceIds: string[];
  racesTotal: number;
  racesCounted: number;
  rows: StandingRow[];
}

type RawCell = Omit<StandingCell, 'counted'>;

/** Итог райдера в гонке: нет строки — 0 (выбрасывается), DQ — 0 (не выбрасывается), иначе очки места. */
export function cellOf(raceId: string, row: StandingsSourceRow | undefined): RawCell {
  if (!row) return { raceId, place: null, tied: false, outcome: 'none', points: 0 };
  if (row.status === 'dq' || row.place === null) {
    return { raceId, place: null, tied: false, outcome: 'dq', points: 0 };
  }
  return {
    raceId,
    place: row.place,
    tied: row.tied,
    outcome: 'placed',
    points: pointsForPlace(row.place),
  };
}

/**
 * Засчитанные ячейки (S11, RC-10): кандидаты — сначала DQ по порядку гонок, затем «с местом» по
 * `(points desc, place asc, порядок гонки)`; первые `n` — `counted`. «Нет строки» — никогда. Порядок на выходе —
 * порядок гонок.
 */
export function selectCounted(cells: readonly RawCell[], n: number): StandingCell[] {
  const indexed = cells.map((cell, index) => ({ cell, index }));
  const dqs = indexed.filter(({ cell }) => cell.outcome === 'dq');
  const placed = indexed
    .filter(({ cell }) => cell.outcome === 'placed')
    .sort(
      (a, b) => b.cell.points - a.cell.points || a.cell.place! - b.cell.place! || a.index - b.index,
    );
  const counted = new Set([...dqs, ...placed].slice(0, n).map(({ index }) => index));
  return cells.map((cell, index) => ({ ...cell, counted: counted.has(index) }));
}

/** Ключ разбивки ничьей: места засчитанных гонок «с местом» по возрастанию («=2» — 2-е, DQ мест не имеет). */
export function tieKey(cells: readonly StandingCell[]): number[] {
  return cells
    .filter((cell) => cell.counted && cell.outcome === 'placed')
    .map((cell) => cell.place!)
    .sort((a, b) => a - b);
}

interface Ranked {
  userId: string;
  points: number;
  key: number[];
  cells: StandingCell[];
}

/**
 * Порядок в сезоне (S12): больше очков; при равенстве — лексикографически по `tieKey` (меньше место — лучше,
 * отсутствующая позиция = +∞, т. е. «больше первых, затем вторых …»); 0 — равны по месту.
 */
export function compareRiders(
  a: Pick<Ranked, 'points' | 'key'>,
  b: Pick<Ranked, 'points' | 'key'>,
): number {
  if (a.points !== b.points) return b.points - a.points;
  const length = Math.max(a.key.length, b.key.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.key[i] ?? Number.POSITIVE_INFINITY;
    const y = b.key[i] ?? Number.POSITIVE_INFINITY;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const byWindow = (a: StandingsRaceInput, b: StandingsRaceInput) =>
  a.windowEndsAt.getTime() - b.windowEndsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface TableDraft {
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
  races: StandingsRaceInput[];
  byUser: Map<string, Map<string, StandingsSourceRow>>;
}

/** Строки одной таблицы: очки, засчитанные, места и ничьи; порядок внутри «=N» — по `userId`. */
function rankTable(draft: TableDraft): SeasonTable {
  const m = draft.races.length;
  const n = racesCounted(m);
  const riders: Ranked[] = [...draft.byUser].map(([userId, rows]) => {
    const cells = selectCounted(
      draft.races.map((race) => cellOf(race.id, rows.get(race.id))),
      n,
    );
    const points = cells.reduce((sum, cell) => sum + (cell.counted ? cell.points : 0), 0);
    return { userId, points, key: tieKey(cells), cells };
  });
  riders.sort((a, b) => compareRiders(a, b) || (a.userId < b.userId ? -1 : 1));
  // отсортированы: равные по месту идут подряд — одна серия «=N» с местом первого
  const rows: StandingRow[] = [];
  for (let start = 0; start < riders.length;) {
    let end = start + 1;
    while (end < riders.length && compareRiders(riders[start]!, riders[end]!) === 0) end += 1;
    for (let index = start; index < end; index += 1) {
      const rider = riders[index]!;
      rows.push({
        userId: rider.userId,
        order: index,
        place: start + 1,
        tied: end - start >= 2,
        points: rider.points,
        cells: rider.cells,
      });
    }
    start = end;
  }
  return {
    bikeClass: draft.bikeClass,
    groupKey: draft.groupKey,
    raceIds: draft.races.map((race) => race.id),
    racesTotal: m,
    racesCounted: n,
    rows,
  };
}

/**
 * Таблицы сезона «класс × группа» (S13): M — гонки класса, схема которых даёт группу (гонка без строк группы — тоже);
 * в таблице — райдеры с хотя бы одной строкой снимка (в т. ч. только DQ). Таблицы без строк не возвращаются.
 * Порядок — `BIKE_CLASSES`, затем `RESULT_GROUP_KEYS`.
 */
export function buildSeasonStandings(races: readonly StandingsRaceInput[]): SeasonTable[] {
  const drafts = new Map<string, TableDraft>();
  const table = (bikeClass: BikeClass, groupKey: ResultGroupKey) => {
    const key = `${bikeClass}:${groupKey}`;
    let draft = drafts.get(key);
    if (!draft) {
      draft = { bikeClass, groupKey, races: [], byUser: new Map() };
      drafts.set(key, draft);
    }
    return draft;
  };
  for (const race of [...races].sort(byWindow)) {
    for (const group of schemeGroups(race.groupScheme))
      table(race.bikeClass, group).races.push(race);
    for (const row of race.rows) {
      const draft = table(race.bikeClass, row.groupKey);
      // группа не из схемы гонки (не должно быть) — гонка входит в M этой таблицы; гонки идут по порядку окна
      if (draft.races.at(-1) !== race) draft.races.push(race);
      let rows = draft.byUser.get(row.userId);
      if (!rows) {
        rows = new Map();
        draft.byUser.set(row.userId, rows);
      }
      rows.set(race.id, row);
    }
  }
  return [...drafts.values()]
    .filter((draft) => draft.byUser.size > 0)
    .sort(
      (a, b) =>
        BIKE_CLASSES.indexOf(a.bikeClass) - BIKE_CLASSES.indexOf(b.bikeClass) ||
        RESULT_GROUP_KEYS.indexOf(a.groupKey) - RESULT_GROUP_KEYS.indexOf(b.groupKey),
    )
    .map(rankTable);
}

/**
 * Отпечаток источника сезона (RC-13): sha256 hex JSON `[formulaVersion, гонки по id → [id, revision, bikeClass,
 * groupScheme]]` — от порядка входа не зависит.
 */
export function sourceFingerprint(
  races: readonly Pick<StandingsRaceInput, 'id' | 'revision' | 'bikeClass' | 'groupScheme'>[],
  formulaVersion: number = STANDINGS_FORMULA_VERSION,
): string {
  const items = [...races]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((race) => [race.id, race.revision, race.bikeClass, race.groupScheme]);
  return createHash('sha256')
    .update(JSON.stringify([formulaVersion, items]))
    .digest('hex');
}

/** Монотонная версия источника (RC-5): Σ текущих ревизий гонок сезона с протоколом. */
export const sourceVersion = (races: readonly { revision: number }[]): number =>
  races.reduce((sum, race) => sum + race.revision, 0);
