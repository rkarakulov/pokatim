/** Время панели — Europe/Minsk (AGENTS.md §4.7): в БД и API — UTC. */
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Minsk',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** «25.10.2026, 13:00» по Минску из ISO UTC. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
