import {
  minskToday,
  type CalendarStartCard,
  type CalendarStartDetail,
  type YearMonth,
} from '@pokatim/contracts';
import { t, type MessageKey } from '@pokatim/i18n';

import {
  domainLabel,
  formatDistances,
  formatLocalRange,
  heroDateText,
  meta,
  type HeroDate,
} from '@/lib/minsk-format';

/**
 * Подписи календаря стартов (Главная, вкладка «Календарь», карточка старта) — чистые функции (`now` — параметр).
 * Общие даты и списки — `src/lib/minsk-format.ts`, подписи гонки — `features/races/format.ts`.
 */

const DAY_MS = 86_400_000;

/**
 * Дата старта: «14» + «июня 2027», многодневный — «26–27» + «июня». `now = null` (карточка, SSR) — всегда с годом.
 */
export function formatCalendarStartDate(card: CalendarStartCard, now: Date | null): HeroDate {
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
  if (days > 0) return t('calendar.daysLeft', { count: days });
  if (days === 0) return t('calendar.today');
  const endsOn = card.endsOn;
  return endsOn !== null && endsOn >= minskToday(now) ? t('calendar.ongoing') : null;
}

/** Мета старта: «80 и 120 км · Шоссе · Минск». */
export function calendarMeta(card: CalendarStartCard): string {
  return meta([
    formatDistances(card.distancesKm),
    domainLabel('domain.discipline', card.discipline),
    card.city,
  ]);
}

/** Подпись группы месяца в списке — всегда с годом: «Июнь 2027» (Q14). */
export function monthGroupLabel(month: YearMonth): string {
  return t('format.dateWithYear', {
    date: t(`date.monthName.${Number(month.slice(5, 7))}` as MessageKey),
    year: Number(month.slice(0, 4)),
  });
}

/** «8:00» из `LocalTime` «08:00». */
const clockTime = (time: string) => time.replace(/^0(?=\d)/, '');

/**
 * Строка места карточки: «Старт в 8:00 · Минск, площадь Независимости»; без времени — «Минск, площадь …»; без места —
 * только город. Пусто — `null`.
 */
export function startPlaceLine(start: CalendarStartDetail): string | null {
  const [head, next] = [start.city, start.place].filter((part): part is string => !!part?.trim());
  const place = head === undefined ? null : next ? t('format.listComma', { head, next }) : head;
  if (start.startTime === null) return place;
  const time = clockTime(start.startTime);
  return place === null
    ? t('calendar.detail.startAtOnly', { time })
    : t('calendar.detail.startAt', { time, place });
}

/** Описание для OG: «14 июня 2027 · Шоссе · Минск · 100 км» — только публичные поля, пустые пропускаются. */
export function calendarShareDescription(start: CalendarStartCard): string {
  return meta([
    heroDateText(formatCalendarStartDate(start, null)),
    domainLabel('domain.discipline', start.discipline),
    start.city,
    formatDistances(start.distancesKm),
  ]);
}
