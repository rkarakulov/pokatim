import { PLATFORM_TIME_ZONE } from '@pokatim/contracts';

/** Время панели — Europe/Minsk (AGENTS.md §4.7): в БД и API — UTC. */
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: PLATFORM_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** «25 октября 2026, 23:59» по Минску. */
const DATE_TIME_LONG = new Intl.DateTimeFormat('ru-RU', {
  timeZone: PLATFORM_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Календарная дата без пояса («1 апреля 2026»): `YYYY-MM-DD` форматируется как полдень UTC того же дня. */
const DATE_LONG = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Части даты без «г.» и «в» (как в прототипах: «25 октября 2026, 23:59»). */
function parts(format: Intl.DateTimeFormat, date: Date) {
  const list = format.formatToParts(date);
  return (type: Intl.DateTimeFormatPartTypes) =>
    list.find((part) => part.type === type)?.value ?? '';
}

/** «25.10.2026, 13:00» по Минску из ISO UTC. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** «25 октября 2026, 23:59» по Минску из ISO UTC. */
export function formatDateTimeLong(iso: string): string {
  const part = parts(DATE_TIME_LONG, new Date(iso));
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`;
}

const KM = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** «86,0 км» из метров (длина маршрута, 0,1 км). */
export function formatKmFromMeters(meters: number): string {
  return `${KM.format(Math.round(meters / 100) / 10)} км`;
}

/** «1 апреля 2026» из календарной даты `YYYY-MM-DD` (дата Минска, без перевода). */
export function formatLocalDate(date: string): string {
  const part = parts(DATE_LONG, new Date(`${date}T12:00:00Z`));
  return `${part('day')} ${part('month')} ${part('year')}`;
}
