import type { ProtocolRowStatus, ResultGroupKey, ResultUnrankedReason } from '@pokatim/contracts';

import type { ChangedCursor, RiderChanges } from '../../changed-since';

/**
 * Порт `results` для модуля `riders` (rider-profile, через `modules/results/index.ts`): строки опубликованных
 * протоколов райдера (только текущие ревизии) и названия гонок. `riders` коллекций `results` не читает.
 */
export const RIDER_RESULTS = Symbol('RIDER_RESULTS');

/** Предел строк райдера на одно чтение (десятки–сотни на практике); больше — лог, без отказа. */
export const RIDER_RESULTS_MAX_ROWS = 2000;

/** Строка текущей ревизии опубликованного протокола (Verified-строки: START и «без пульса» в снимок не входят). */
export interface RiderProtocolRow {
  raceId: string;
  place: number | null;
  tied: boolean;
  /** `final` | `revised` | `dq` */
  status: ProtocolRowStatus;
  /** ревизии до race-results-07 — `overall` */
  groupKey: ResultGroupKey;
  elapsedSec: number;
  /** старт лучшего сегмента — внутри окна гонки (порядок «по дате гонки») */
  startedAt: Date;
}

/**
 * Строка «в зачёте» (R6, achievements RC-9): не DQ и место есть. Единый предикат статистики профиля (`riders`) и
 * гоночных достижений (`achievements`): «Гонщик» (бронза) ⇔ `stats.races ≥ 5`.
 */
export const isRankedRow = (row: RiderProtocolRow): row is RiderProtocolRow & { place: number } =>
  row.status !== 'dq' && row.place !== null;

/**
 * Финиш без места (rider-links-in-tables, RC-A3 (b)): START или Verified без пульса в гонке с опубликованным протоколом —
 * в снимок протокола не входит, читается из заявки (условие — как у таблицы финишёров).
 */
export interface RiderFinishRow {
  raceId: string;
  groupKey: ResultGroupKey;
  elapsedSec: number;
  /** старт лучшего сегмента — внутри окна гонки */
  startedAt: Date;
  unranked: ResultUnrankedReason;
}

export interface RiderRaceInfo {
  title: string;
  windowStartsAt: Date;
}

export interface RiderResults {
  /**
   * Строки пользователя в текущих ревизиях протоколов: строка, выпавшая из поздней ревизии, не возвращается. Порядок
   * не задан.
   */
  publishedRows(userId: string): Promise<RiderProtocolRow[]>;
  /** Финиши без места пользователя по гонкам с опубликованным протоколом (есть ревизия). Порядок не задан. */
  publishedFinishes(userId: string): Promise<RiderFinishRow[]>;
  /** Названия и окна гонок (опубликованные и отменённые; черновик и неизвестная — нет в карте). */
  racesOf(raceIds: readonly string[]): Promise<Map<string, RiderRaceInfo>>;
  /**
   * Райдеры ревизий протоколов (публикация, пересчёт), записанных в окне `(after, until]` (серверная сверка
   * достижений, achievements-push): журнал пересчётов с числовой ревизией по `_id` (uuidv7 = время записи; пустой `id`
   * курсора — момент `at` включительно) → `userId` строк этой ревизии. Предел — `limit` записей журнала; курсор —
   * последняя прочитанная запись.
   */
  revisedRidersAfter(after: ChangedCursor, until: Date, limit: number): Promise<RiderChanges>;
}
