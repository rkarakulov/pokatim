import {
  addLocalDays,
  BIKE_CLASSES,
  minskToday,
  type BikeClass,
  type YearMonth,
} from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';

/**
 * Фильтры вкладки «Гонки» — состояние экрана (R7): сбрасываются при перезапуске, в URL не попадают. Внутри группы —
 * ИЛИ, между — И (делает сервер, `RaceListQuery`). Значения — отсортированы: ключ запроса стабилен.
 */
export interface RaceFilters {
  bikeClass: readonly BikeClass[];
  month: readonly YearMonth[];
}

export const NO_FILTERS: RaceFilters = { bikeClass: [], month: [] };

/** Сколько месяцев в фильтре «Дата»: текущий по Минску и два следующих (Q6). */
const MONTH_CHIPS = 3;

/** Три месяца от текущего по Минску: `['2026-11', '2026-12', '2027-01']`. */
export function monthChips(now: Date): YearMonth[] {
  const first = `${minskToday(now).slice(0, 7)}-01`;
  return Array.from({ length: MONTH_CHIPS }, (_, i) =>
    // 1-е число + 31·i дней всегда попадает в i-й следующий месяц (i ≤ 2)
    addLocalDays(first, 31 * i).slice(0, 7),
  );
}

const monthNumber = (month: YearMonth) => Number(month.slice(5, 7));

export const hasFilters = (filters: RaceFilters) =>
  filters.bikeClass.length > 0 || filters.month.length > 0;

/** Классы в порядке справочника (Шоссе · ТТ · Гравий · МТБ). */
export const CLASS_CHIPS: readonly BikeClass[] = BIKE_CLASSES;

/**
 * Текст пустого результата: один класс и один месяц — «Нет гонок класса «МТБ» в ноябре.», иначе — «Нет гонок по
 * выбранным фильтрам.» [ASSUMPTION, Q11].
 */
export function noMatchMessage(filters: RaceFilters): string {
  const [bikeClass] = filters.bikeClass;
  const [month] = filters.month;
  if (filters.bikeClass.length === 1 && filters.month.length === 1 && bikeClass && month) {
    return t('races.noMatchClassMonth', {
      bikeClass: t(`domain.bikeClass.${bikeClass}` as MessageKey),
      month: t(`date.monthIn.${monthNumber(month)}` as MessageKey),
    });
  }
  return t('races.noMatch');
}
