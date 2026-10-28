import type { RiderProtocolRow } from '../results';

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

/** Строка даёт место: не DQ и место есть. */
const placed = (row: RiderProtocolRow): row is RiderProtocolRow & { place: number } =>
  row.status !== 'dq' && row.place !== null;

/**
 * Сводка (rider-profile, RC-A3): считаются только строки текущих ревизий опубликованных протоколов (START и
 * «без пульса» в снимок не входят — у них «В зачёте: 0»). Чистая функция.
 */
export function summarize(rows: readonly RiderProtocolRow[]): RiderSummary {
  const ranked = rows.filter(placed);
  const bestPlaces = [...ranked]
    .sort((a, b) => a.place - b.place || b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, BEST_PLACES);
  return {
    races: ranked.length,
    podiums: ranked.filter((row) => row.place <= PODIUM_MAX).length,
    bestPlaces,
  };
}

/** Позиция курсора истории: момент старта сегмента (ISO) и id гонки. */
export interface RowCursor {
  k: string;
  id: string;
}

const newerFirst = (a: RiderProtocolRow, b: RiderProtocolRow) =>
  b.startedAt.getTime() - a.startedAt.getTime() || (a.raceId < b.raceId ? 1 : -1);

/**
 * Страница публичной истории в памяти (строк райдера — десятки–сотни): старт сегмента лежит в окне гонки — порядок
 * «по дате гонки», новые сверху; при равенстве — id гонки ↓. Курсор — после строки `(k, id)`.
 */
export function pageRows(
  rows: readonly RiderProtocolRow[],
  cursor: RowCursor | null,
  limit: number,
): { page: RiderProtocolRow[]; next: RowCursor | null } {
  const sorted = [...rows].sort(newerFirst);
  const after = cursor
    ? sorted.filter((row) => {
        const at = row.startedAt.getTime();
        const k = new Date(cursor.k).getTime();
        return at < k || (at === k && row.raceId < cursor.id);
      })
    : sorted;
  const page = after.slice(0, limit);
  const last = page.at(-1);
  return {
    page,
    next:
      after.length > limit && last ? { k: last.startedAt.toISOString(), id: last.raceId } : null,
  };
}
