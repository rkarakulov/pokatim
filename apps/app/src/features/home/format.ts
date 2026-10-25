import {
  addLocalDays,
  minskToday,
  utcToMinskWallTime,
  type CalendarStartCard,
  type RaceCard,
} from '@pokatim/contracts';
import { i18n, t, type MessageKey } from '@pokatim/i18n';

/**
 * Подписи героев Главной — чистые функции (`now` — параметр). Время — только `contracts/src/time.ts` (перевод UTC →
 * Минск, «сегодня» Минска); пояс устройства не участвует (§4.7). Фаза окна — с сервера, клиент её не вычисляет.
 */

/** Дата героя: крупно и подпись рядом («4–12» + «октября»); без подписи — вся строка крупно. */
export interface HeroDate {
  value: string;
  unit?: string;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

const DAY_MS = 86_400_000;

function parts(localDate: string): LocalDateParts {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

const monthName = (month: number) => t(`date.month.${month}` as MessageKey);
const dayMonth = ({ day, month }: LocalDateParts) =>
  t('home.dayMonth', { day, month: monthName(month) });
const dateWithYear = (date: string, year: number) => t('home.dateWithYear', { date, year });
const withYear = (text: string, year: number, currentYear: number) =>
  year === currentYear ? text : dateWithYear(text, year);
const range = (from: string | number, to: string | number) => t('home.range', { from, to });

/** Диапазон календарных дат Минска: один день, один месяц, разные месяцы, разные годы (тире без пробелов). */
function formatLocalRange(from: string, to: string, now: Date): HeroDate {
  const currentYear = parts(minskToday(now)).year;
  const a = parts(from);
  const b = parts(to);
  if (a.year !== b.year) {
    return { value: range(dateWithYear(dayMonth(a), a.year), dateWithYear(dayMonth(b), b.year)) };
  }
  if (a.month !== b.month) {
    return { value: withYear(range(dayMonth(a), dayMonth(b)), a.year, currentYear) };
  }
  const value = a.day === b.day ? `${a.day}` : range(a.day, b.day);
  return { value, unit: withYear(monthName(a.month), a.year, currentYear) };
}

/** «4 октября» (год — только если не текущий по Минску) и время «HH:mm» момента UTC. */
function minskDateTime(iso: string, now: Date) {
  const wall = utcToMinskWallTime(iso);
  const date = parts(wall.slice(0, 10));
  return {
    localDate: wall.slice(0, 10),
    date: withYear(dayMonth(date), date.year, parts(minskToday(now)).year),
    time: wall.slice(11, 16),
  };
}

/** Окно гонки по Минску: «4–12» + «октября». */
export function formatRaceWindow(startsAt: string, endsAt: string, now: Date): HeroDate {
  return formatLocalRange(
    utcToMinskWallTime(startsAt).slice(0, 10),
    utcToMinskWallTime(endsAt).slice(0, 10),
    now,
  );
}

/**
 * Строка жизненного цикла гонки по фазе сервера: `upcoming` — открытие и закрытие, `open` — до закрытия (сегодня /
 * завтра по Минску — отдельно); `'unknown'` и прочие — без строки (R9).
 */
export function raceLifecycleLine(race: RaceCard, now: Date): string | null {
  const closes = minskDateTime(race.windowEndsAt, now);
  if (race.phase === 'upcoming') {
    const opens = minskDateTime(race.windowStartsAt, now);
    return t('home.races.upcoming', {
      opens: opens.date,
      openTime: opens.time,
      closes: closes.date,
      closeTime: closes.time,
    });
  }
  if (race.phase === 'open') {
    const today = minskToday(now);
    if (closes.localDate === today) return t('home.races.closesToday', { closeTime: closes.time });
    if (closes.localDate === addLocalDays(today, 1)) {
      return t('home.races.closesTomorrow', { closeTime: closes.time });
    }
    return t('home.races.openUntil', { closes: closes.date, closeTime: closes.time });
  }
  return null;
}

/** Дата старта: «14» + «июня 2027», многодневный — «26–27» + «июня». */
export function formatCalendarStartDate(card: CalendarStartCard, now: Date): HeroDate {
  return formatLocalRange(card.startsOn, card.endsOn ?? card.startsOn, now);
}

/** Дней до старта по календарным датам Минска (0 — сегодня, отрицательное — уже начался). */
export function daysUntilStart(startsOn: string, now: Date): number {
  return Math.round(
    (Date.parse(`${startsOn}T00:00:00Z`) - Date.parse(`${minskToday(now)}T00:00:00Z`)) / DAY_MS,
  );
}

/** «До старта N дней.», «Старт сегодня.», многодневный идущий — «Идёт сейчас.». */
export function calendarStatusLine(card: CalendarStartCard, now: Date): string | null {
  const days = daysUntilStart(card.startsOn, now);
  if (days > 0) return t('home.calendar.daysLeft', { count: days });
  if (days === 0) return t('home.calendar.today');
  const endsOn = card.endsOn;
  return endsOn !== null && endsOn >= minskToday(now) ? t('home.calendar.ongoing') : null;
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
  const head = joinWith('home.listComma', values);
  const list = head === null ? last : t('home.listAnd', { head, last });
  return t('home.distanceKm', { distance: list });
}

/** Подпись значения справочника; `'unknown'` (новое значение у старой сборки) — без подписи (R9). */
function domainLabel(prefix: string, value: string): string | null {
  return value === 'unknown' ? null : t(`${prefix}.${value}` as MessageKey);
}

/** Мета героя: элементы через « · » (`home.metaJoin`), пустые — пропускаются. */
const meta = (parts: readonly (string | null)[]) =>
  joinWith(
    'home.metaJoin',
    parts.filter((part): part is string => part !== null && part !== ''),
  ) ?? '';

/** Мета гонки: «62 км · Гравий». */
export function raceMeta(race: RaceCard): string {
  return meta([
    formatDistances([race.distanceKm]),
    ...race.surfaces.map((surface) => domainLabel('domain.surface', surface)),
  ]);
}

/** Мета старта: «80 и 120 км · Шоссе · Минск». */
export function calendarMeta(card: CalendarStartCard): string {
  return meta([
    formatDistances(card.distancesKm),
    domainLabel('domain.discipline', card.discipline),
    card.city,
  ]);
}
