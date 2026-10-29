import { isRankedRow, type RiderProtocolRow } from '../results';

/** Сводка опубликованных протоколов райдера: строки с местом, подиумы и до трёх лучших мест. */
export interface RiderSummary {
  /** строки с местом (без DQ) — «в зачёте» */
  races: number;
  /** места 1–3 */
  podiums: number;
  /** до трёх лучших: место ↑, при равенстве — новее */
  bestPlaces: RiderProtocolRow[];
}

const BEST_PLACES = 3;
const PODIUM_MAX = 3;

/**
 * Сводка (rider-profile, RC-A3): считаются только строки текущих ревизий опубликованных протоколов (START и
 * «без пульса» в снимок не входят — у них «В зачёте: 0»). Чистая функция.
 */
export function summarize(rows: readonly RiderProtocolRow[]): RiderSummary {
  const ranked = rows.filter(isRankedRow);
  const bestPlaces = [...ranked]
    .sort((a, b) => a.place - b.place || b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, BEST_PLACES);
  return {
    races: ranked.length,
    podiums: ranked.filter((row) => row.place <= PODIUM_MAX).length,
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

const newerFirst = (a: RiderProtocolRow, b: RiderProtocolRow) =>
  b.startedAt.getTime() - a.startedAt.getTime() || (a.raceId < b.raceId ? 1 : -1);

/**
 * Страница публичной истории в памяти (строк райдера — десятки–сотни, одна строка на гонку): старт сегмента лежит в
 * окне гонки — порядок «по дате гонки», новые сверху; при равенстве — id гонки ↓. Курсор — после строки гонки `id`;
 * гонки нет в списке (чужой курсор, строка выпала из ревизии) — `null`, вызывающий отвечает 400.
 */
export function pageRows(
  rows: readonly RiderProtocolRow[],
  cursor: RowCursor | null,
  limit: number,
): { page: RiderProtocolRow[]; next: RowCursor | null } | null {
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
