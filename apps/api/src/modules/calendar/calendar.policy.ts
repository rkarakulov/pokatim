import type { CalendarPhase } from '@pokatim/contracts';

/**
 * Фаза старта по датам Минска (ADR-0010 п. 6): `today` — `minskToday(CLOCK.now())`. Строки `LocalDate`
 * сравниваются лексикографически (`YYYY-MM-DD`), без `Date`.
 */
export function calendarPhase(
  start: { startsOn: string; endsOn: string | null },
  today: string,
): CalendarPhase {
  if (start.startsOn > today) return 'upcoming';
  if ((start.endsOn ?? start.startsOn) < today) return 'finished';
  return 'ongoing';
}
