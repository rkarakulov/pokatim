/** Событие старше этого к моменту обработки уведомления не создаёт (`docs/product/notifications.md`, RC-6). */
export const EVENT_MAX_AGE_MS = 72 * 3_600_000;

const UUID_V7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Момент события outbox по его id: первые 48 бит uuidv7 — Unix-время в мс (RFC 9562 §5.7). Своего хелпера в api-kit
 * нет, `createdAt` outbox читатель базы не отдаёт (RC-6). Не uuidv7 — `null`.
 */
export function eventTimeOf(eventId: string): Date | null {
  const match = UUID_V7.exec(eventId);
  if (!match) return null;
  return new Date(Number.parseInt(`${match[1]}${match[2]}`, 16));
}

/**
 * Событие устарело: старше `EVENT_MAX_AGE_MS` относительно `now` (`CLOCK`) или время не читается. Событие «из
 * будущего» (id собран по `Date.now()`, а часы сервиса позади) — свежее.
 */
export function isEventStale(eventId: string, now: Date): boolean {
  const at = eventTimeOf(eventId);
  return at === null || now.getTime() - at.getTime() > EVENT_MAX_AGE_MS;
}
