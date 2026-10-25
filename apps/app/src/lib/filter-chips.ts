import { minskToday, type YearMonth } from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';

/** Общие чипы фильтров вкладок («Гонки», «Календарь»): подпись месяца и переключение значения. */

const monthNumber = (month: YearMonth) => Number(month.slice(5, 7));
const monthYear = (month: YearMonth) => Number(month.slice(0, 4));

/** Подпись чипа месяца (именительный падеж): «Ноябрь»; не текущего года по Минску — «Январь 2027». */
export function monthChipLabel(month: YearMonth, now: Date): string {
  const name = t(`date.monthName.${monthNumber(month)}` as MessageKey);
  return monthYear(month) === Number(minskToday(now).slice(0, 4))
    ? name
    : t('format.dateWithYear', { date: name, year: monthYear(month) });
}

/** Добавить значение или снять его; результат — отсортирован. */
export function toggle<T extends string>(list: readonly T[], value: T): T[] {
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return next.sort();
}
