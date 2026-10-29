import type { ResultUnrankedReason } from '@pokatim/contracts';

import { isRankedRow, type RiderFinishRow, type RiderProtocolRow } from '../results';

/** Сводка опубликованных протоколов райдера: строки с местом, подиумы, финиши и до трёх лучших мест. */
export interface RiderSummary {
  /** строки с местом (без DQ) — «в зачёте» */
  races: number;
  /** места 1–3 */
  podiums: number;
  /** гонки с финишем: «в зачёте» + финиши без места (START, Verified без пульса); DQ — нет */
  finishes: number;
  /** до трёх лучших: место ↑, при равенстве — новее */
  bestPlaces: RiderProtocolRow[];
}

const BEST_PLACES = 3;
const PODIUM_MAX = 3;

/**
 * Сводка (rider-profile, RC-A3): «в зачёте», подиумы и лучшие места — только строки текущих ревизий опубликованных
 * протоколов (START и «без пульса» в снимок не входят — у них «В зачёте: 0», как у достижений). «Финиши»
 * (rider-links-in-tables, RC-A3 (b)) — гонки со строкой «в зачёте» или финишем без места, без повторов гонки. Чистая
 * функция.
 */
export function summarize(
  rows: readonly RiderProtocolRow[],
  finishes: readonly RiderFinishRow[] = [],
): RiderSummary {
  const ranked = rows.filter(isRankedRow);
  const bestPlaces = [...ranked]
    .sort((a, b) => a.place - b.place || b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, BEST_PLACES);
  return {
    races: ranked.length,
    podiums: ranked.filter((row) => row.place <= PODIUM_MAX).length,
    finishes: new Set([...ranked, ...finishes].map((row) => row.raceId)).size,
    bestPlaces,
  };
}

/**
 * Позиция курсора публичной истории — только id гонки последней строки (HIGH-1 ревью): время старта сегмента (время
 * суток заезда) в курсор не попадает — курсор публичный и декодируется любым посетителем.
 */
export interface RowCursor {
  id: string;
}

/** Строка публичной истории: строка протокола (`unranked: null`) или финиш без места. */
export type RiderHistoryRow = RiderProtocolRow & { unranked: ResultUnrankedReason | null };

/**
 * История — строки протокола и финиши без места (одна строка на гонку): финиш — без места и ничьей, статус `final`
 * (протокол опубликован). Гонка уже есть в протоколе — финиш не добавляется.
 */
export function historyRows(
  rows: readonly RiderProtocolRow[],
  finishes: readonly RiderFinishRow[],
): RiderHistoryRow[] {
  const inProtocol = new Set(rows.map((row) => row.raceId));
  return [
    ...rows.map((row) => ({ ...row, unranked: null })),
    ...finishes
      .filter((finish) => !inProtocol.has(finish.raceId))
      .map((finish) => ({
        raceId: finish.raceId,
        place: null,
        tied: false,
        status: 'final' as const,
        groupKey: finish.groupKey,
        elapsedSec: finish.elapsedSec,
        startedAt: finish.startedAt,
        unranked: finish.unranked,
      })),
  ];
}

const newerFirst = (
  a: Pick<RiderProtocolRow, 'raceId' | 'startedAt'>,
  b: Pick<RiderProtocolRow, 'raceId' | 'startedAt'>,
) => b.startedAt.getTime() - a.startedAt.getTime() || (a.raceId < b.raceId ? 1 : -1);

/**
 * Страница публичной истории в памяти (строк райдера — десятки–сотни, одна строка на гонку): старт сегмента лежит в
 * окне гонки — порядок «по дате гонки», новые сверху; при равенстве — id гонки ↓. Курсор — после строки гонки `id`;
 * гонки нет в списке (чужой курсор, строка выпала из ревизии) — `null`, вызывающий отвечает 400.
 */
export function pageRows<Row extends Pick<RiderProtocolRow, 'raceId' | 'startedAt'>>(
  rows: readonly Row[],
  cursor: RowCursor | null,
  limit: number,
): { page: Row[]; next: RowCursor | null } | null {
  const sorted = [...rows].sort(newerFirst);
  let start = 0;
  if (cursor) {
    const at = sorted.findIndex((row) => row.raceId === cursor.id);
    if (at < 0) return null;
    start = at + 1;
  }
  const after = sorted.slice(start);
  const page = after.slice(0, limit);
  const last = page.at(-1);
  return { page, next: after.length > limit && last ? { id: last.raceId } : null };
}
