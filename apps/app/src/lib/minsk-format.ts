import { minskToday, utcToMinskWallTime } from '@pokatim/contracts';
import { i18n, t, type MessageKey } from '@pokatim/i18n';

/**
 * Общие подписи дат и списков (Главная, вкладка «Гонки», публичные карточки) — чистые функции. Время — только
 * `contracts/src/time.ts` (перевод UTC → Минск, «сегодня» Минска); пояс устройства не участвует (§4.7).
 *
 * `now: Date | null` — «сейчас» для года: дата не текущего года по Минску — с годом. `null` (SSR и первый клиентский
 * рендер публичного экрана) — год всегда: текст не зависит от «сейчас», HTML сервера совпадает с гидрацией.
 */

/** Дата крупно и подпись рядом («4–12» + «октября»); без подписи — вся строка крупно. */
export interface HeroDate {
  value: string;
  unit?: string;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function parts(localDate: string): LocalDateParts {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

const monthName = (month: number) => t(`date.month.${month}` as MessageKey);
const dayMonth = ({ day, month }: LocalDateParts) =>
  t('format.dayMonth', { day, month: monthName(month) });
const dateWithYear = (date: string, year: number) => t('format.dateWithYear', { date, year });
const currentYear = (now: Date | null) => (now === null ? null : parts(minskToday(now)).year);
const withYear = (text: string, year: number, now: Date | null) =>
  year === currentYear(now) ? text : dateWithYear(text, year);
const range = (from: string | number, to: string | number) => t('format.range', { from, to });

/** Диапазон календарных дат Минска: один день, один месяц, разные месяцы, разные годы (тире без пробелов). */
export function formatLocalRange(from: string, to: string, now: Date | null): HeroDate {
  const a = parts(from);
  const b = parts(to);
  if (a.year !== b.year) {
    return { value: range(dateWithYear(dayMonth(a), a.year), dateWithYear(dayMonth(b), b.year)) };
  }
  if (a.month !== b.month) {
    return { value: withYear(range(dayMonth(a), dayMonth(b)), a.year, now) };
  }
  const value = a.day === b.day ? `${a.day}` : range(a.day, b.day);
  return { value, unit: withYear(monthName(a.month), a.year, now) };
}

/** Дата героя одной строкой: «4–12 октября», «28 сентября–3 октября». */
export const heroDateText = (date: HeroDate) =>
  date.unit ? `${date.value} ${date.unit}` : date.value;

/** Момент UTC по Минску: календарная дата, «4 октября» (год — по правилу `now`) и время «HH:mm». */
export function minskDateTime(iso: string, now: Date | null) {
  const wall = utcToMinskWallTime(iso);
  const date = parts(wall.slice(0, 10));
  return {
    localDate: wall.slice(0, 10),
    date: withYear(dayMonth(date), date.year, now),
    time: wall.slice(11, 16),
  };
}

const km = (value: number) => i18n.formatNumber(value, { maximumFractionDigits: 1 });

/** Склейка элементов по шаблону строки (`{head}` + `{next}`); пусто — `null`. */
const joinWith = (key: MessageKey, items: readonly string[]): string | null =>
  items.length === 0 ? null : items.reduce((head, next) => t(key, { head, next }));

/** «100 км», «80 и 120 км», «40, 80 и 120 км»; пусто — `null`. */
export function formatDistances(distances: readonly number[]): string | null {
  const values = distances.map(km);
  const last = values.pop();
  if (last === undefined) return null;
  const head = joinWith('format.listComma', values);
  const list = head === null ? last : t('format.listAnd', { head, last });
  return t('format.distanceKm', { distance: list });
}

/** Подпись значения справочника; `'unknown'` (новое значение у старой сборки) — без подписи (R9). */
export function domainLabel(prefix: string, value: string): string | null {
  return value === 'unknown' ? null : t(`${prefix}.${value}` as MessageKey);
}

/** Мета: элементы через « · » (`format.metaJoin`), пустые — пропускаются. */
export const meta = (items: readonly (string | null)[]) =>
  joinWith(
    'format.metaJoin',
    items.filter((item): item is string => item !== null && item !== ''),
  ) ?? '';
