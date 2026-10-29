import { minskDateTime, t, type MessageKey } from '@pokatim/i18n';

/**
 * Общие подписи дат и списков (Главная, вкладка «Гонки», публичные карточки) — чистые функции. Время — только
 * `contracts/src/time.ts` (перевод UTC → Минск, «сегодня» Минска); пояс устройства не участвует (§4.7).
 *
 * `now: Date | null` — «сейчас» для года: дата не текущего года по Минску — с годом. `null` (SSR и первый клиентский
 * рендер публичного экрана) — год всегда: текст не зависит от «сейчас», HTML сервера совпадает с гидрацией.
 */

// диапазон дат, дата героя и момент по Минску — общий код `@pokatim/i18n` (приложение, API: карточка для сторис)
export {
  formatDistances,
  formatLocalRange,
  heroDateText,
  minskDateTime,
  type HeroDate,
} from '@pokatim/i18n';

/**
 * Исключающая граница UTC (`uploadClosesAt`: сервер считает поздним момент `>=` границы) по Минску — последняя
 * включённая минута: «до 9 ноября, 23:59», а не «до 10 ноября, 00:00» (B6 смоука dev). Только показ.
 */
export const minskLastMinuteBefore = (iso: string, now: Date | null) =>
  minskDateTime(new Date(Date.parse(iso) - 1).toISOString(), now);

/** День недели календарной даты (0 — воскресенье): арифметика дат, без часового пояса. */
const weekdayOf = (localDate: string) => new Date(`${localDate}T00:00:00Z`).getUTCDay();

/** Время «9:00» — часы без ведущего нуля (прототип райдов). */
const shortTime = (time: string) => time.replace(/^0(\d)/, '$1');

/**
 * Момент UTC по Минску: «день недели, число месяц[, год], время» — общая подпись карточек и лент (кофе-райды).
 * `weekday: 'long'` — «Воскресенье, 4 октября 2026» (подпись дня, карточка), `'short'` — «Сб 3 октября» (герой).
 * Год — по правилу `now` (`null` — всегда). Время — отдельно «9:00» (`time`) и целиком (`full`).
 */
export function formatMinskDateTime(
  iso: string,
  now: Date | null,
  weekday: 'long' | 'short' = 'long',
): { date: string; time: string; full: string } {
  const { localDate, date: dayMonthYear, time } = minskDateTime(iso, now);
  const name = t(
    `${weekday === 'long' ? 'date.weekday' : 'date.weekdayShort'}.${weekdayOf(localDate)}` as MessageKey,
  );
  const date = t(weekday === 'long' ? 'format.weekdayLong' : 'format.weekdayShort', {
    weekday: name,
    date: dayMonthYear,
  });
  const clock = shortTime(time);
  return { date, time: clock, full: t('format.dateTime', { date, time: clock }) };
}

/** Склейка элементов по шаблону строки (`{head}` + `{next}`); пусто — `null`. */
const joinWith = (key: MessageKey, items: readonly string[]): string | null =>
  items.length === 0 ? null : items.reduce((head, next) => t(key, { head, next }));

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
