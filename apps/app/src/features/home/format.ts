import { minskToday, type CalendarStartCard } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';

import {
  domainLabel,
  formatDistances,
  formatLocalRange,
  meta,
  type HeroDate,
} from '@/lib/minsk-format';

/**
 * Подписи героя календаря на Главной — чистые функции (`now` — параметр). Общие даты и списки — `src/lib/minsk-format.ts`,
 * подписи гонки — `features/races/format.ts` (R8 блока 03).
 */

const DAY_MS = 86_400_000;

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

/** Мета старта: «80 и 120 км · Шоссе · Минск». */
export function calendarMeta(card: CalendarStartCard): string {
  return meta([
    formatDistances(card.distancesKm),
    domainLabel('domain.discipline', card.discipline),
    card.city,
  ]);
}
