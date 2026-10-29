import { minskToday, utcToMinskWallTime } from '@pokatim/contracts';

import { i18n, t, type MessageKey } from './core.ts';

/**
 * Общие подписи результата и дат — чистые функции на строках словаря (приложение, панель, карточка для сторис в API).
 * Время — только `contracts/src/time.ts` (UTC → Минск); пояс устройства не участвует (AGENTS.md §4.7).
 *
 * `now: Date | null` — «сейчас» для года: дата не текущего года по Минску — с годом. `null` (SSR, первый клиентский
 * рендер публичного экрана, серверная картинка) — год всегда.
 */

const pad2 = (value: number) => String(value).padStart(2, '0');

/**
 * Длительность «1:02:05» — всегда h:mm:ss, часы без ведущего нуля и без ограничения («25:01:01»). Время результата и
 * попыток (race-results-04, F4).
 */
export function formatElapsed(sec: number): string {
  const total = Math.max(0, Math.trunc(sec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}:${pad2(minutes)}:${pad2(total % 60)}`;
}

/** Место строки результата: «3», при ничьей — «=3». */
export function formatPlace(place: number, tied: boolean): string {
  return tied ? t('races.results.tiePlace', { place }) : String(place);
}

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

/** Число километров: до одного знака после запятой («42», «42,5»). */
export const formatKm = (value: number) => i18n.formatNumber(value, { maximumFractionDigits: 1 });

/** Склейка элементов по шаблону строки (`{head}` + `{next}`); пусто — `null`. */
const joinWith = (key: MessageKey, items: readonly string[]): string | null =>
  items.length === 0 ? null : items.reduce((head, next) => t(key, { head, next }));

/** «100 км», «80 и 120 км», «40, 80 и 120 км»; пусто — `null` (приложение, OG-картинка старта в API). */
export function formatDistances(distances: readonly number[]): string | null {
  const values = distances.map(formatKm);
  const last = values.pop();
  if (last === undefined) return null;
  const head = joinWith('format.listComma', values);
  const list = head === null ? last : t('format.listAnd', { head, last });
  return t('format.distanceKm', { distance: list });
}
