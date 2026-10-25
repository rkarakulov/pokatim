import {
  DISCIPLINES,
  type CalendarStartCard,
  type Discipline,
  type YearMonth,
} from '@pokatim/contracts';

import { toggle } from '@/lib/filter-chips';

/**
 * Фильтры вкладки «Календарь» — состояние экрана: сбрасываются при перезапуске, в URL не попадают. Внутри группы —
 * ИЛИ, между — И (делает сервер, `CalendarQuery`). Значения отсортированы (`toggle`): ключ запроса стабилен.
 */
export interface CalendarFilters {
  discipline: readonly Discipline[];
  city: readonly string[];
  month: readonly YearMonth[];
}

export const NO_FILTERS: CalendarFilters = { discipline: [], city: [], month: [] };

/** Дисциплины в порядке справочника (Шоссе · Гравий · МТБ, Q11). */
export const DISCIPLINE_CHIPS: readonly Discipline[] = DISCIPLINES;

/** Предел значений одной группы в `CalendarQuery` (`city`, `month` — 12). */
const QUERY_VALUES_MAX = 12;

export const hasFilters = (filters: CalendarFilters) =>
  filters.discipline.length > 0 || filters.city.length > 0 || filters.month.length > 0;

/** `toggle` с пределом запроса: 13-е значение не добавляется [ASSUMPTION; на текущих данных недостижимо]. */
export function toggleWithinLimit<T extends string>(list: readonly T[], value: T): T[] {
  if (!list.includes(value) && list.length >= QUERY_VALUES_MAX) return [...list];
  return toggle(list, value);
}

/**
 * Снять значения, которых больше нет среди чипов (месяц прошёл, город ушёл). Значения городов — ровно строки ответа
 * `cities` (регистр и пробелы сводит сервер). `undefined` — ещё не загружено: без изменений.
 */
export function withinAvailable(
  filters: CalendarFilters,
  available: { months?: readonly YearMonth[]; cities?: readonly string[] },
): CalendarFilters {
  const { months, cities } = available;
  return {
    discipline: filters.discipline,
    city: cities ? filters.city.filter((city) => cities.includes(city)) : filters.city,
    month: months ? filters.month.filter((month) => months.includes(month)) : filters.month,
  };
}

export type FeedRow =
  { kind: 'month'; month: YearMonth } | { kind: 'start'; start: CalendarStartCard };

/**
 * Плоские элементы списка «Все старты»: подпись месяца начала — при его смене между соседними записями (поперёк
 * страниц). Многодневный через границу месяцев — в группе месяца начала (R8).
 */
export function groupByMonth(items: readonly CalendarStartCard[]): FeedRow[] {
  const rows: FeedRow[] = [];
  let current: string | null = null;
  for (const start of items) {
    const month = start.startsOn.slice(0, 7);
    if (month !== current) {
      rows.push({ kind: 'month', month });
      current = month;
    }
    rows.push({ kind: 'start', start });
  }
  return rows;
}
