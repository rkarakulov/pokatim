import { TicketView } from '@pokatim/contracts';
import { z } from 'zod';

import { eventEndsAtMs } from './ticket-format';

/**
 * Офлайн-копии билетов (AC12, plan-B §5): последний успешный `TicketView` по коду и момент сохранения (часы
 * устройства). Чистая модель — общая для native (`offline-store.ts`) и web (`offline-store.web.ts`).
 */
export interface OfflineTicket {
  view: TicketView;
  savedAt: number;
}

/** Не больше 10 билетов: у райдера обычно 1–3 предстоящих события. */
export const OFFLINE_TICKETS_LIMIT = 10;
/** Копия живёт сутки после конца события (`endsAt ?? startsAt + 12 ч`). */
export const OFFLINE_TICKET_GRACE_MS = 24 * 3_600_000;

const Entry = z.object({ view: TicketView, savedAt: z.number() });
const OfflineSnapshotSchema = z.object({
  owner: z.string().min(1),
  items: z.record(z.string(), Entry),
});
export type OfflineSnapshot = z.infer<typeof OfflineSnapshotSchema>;

/** Повреждённое или старое значение хранилища — `null` (вызывающий стирает). */
export function parseSnapshot(raw: string | null): OfflineSnapshot | null {
  if (raw === null) return null;
  try {
    const parsed = OfflineSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const expired = (entry: OfflineTicket, now: number) =>
  eventEndsAtMs(entry.view.event) + OFFLINE_TICKET_GRACE_MS < now;

/** Без закончившихся событий и не больше лимита — свежие по `savedAt`. */
export function pruneItems(
  items: Record<string, OfflineTicket>,
  now: number,
): Record<string, OfflineTicket> {
  const kept = Object.entries(items)
    .filter(([, entry]) => !expired(entry, now))
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, OFFLINE_TICKETS_LIMIT);
  return Object.fromEntries(kept);
}

/**
 * Снимок после записи билета `view` владельцем `owner`: чужой снимок (другой аккаунт на устройстве) не продолжается —
 * начинается новый.
 */
export function withTicket(
  snapshot: OfflineSnapshot | null,
  owner: string,
  view: TicketView,
  now: number,
): OfflineSnapshot {
  const items = snapshot && snapshot.owner === owner ? snapshot.items : {};
  return { owner, items: pruneItems({ ...items, [view.code]: { view, savedAt: now } }, now) };
}

/**
 * Снимок без просроченных копий (TTL, лимит) — для записи при чтении: копия не только скрывается, но и удаляется из
 * хранилища (вместе с QR). `null` — менять нечего.
 */
export function prunedSnapshot(
  snapshot: OfflineSnapshot | null,
  now: number,
): OfflineSnapshot | null {
  if (!snapshot) return null;
  const items = pruneItems(snapshot.items, now);
  return Object.keys(items).length === Object.keys(snapshot.items).length
    ? null
    : { owner: snapshot.owner, items };
}

/**
 * Копия для показа: владелец совпал (или неизвестен — `null`: web без связи с сервером при запуске, RC-B4), событие
 * не закончилось больше суток назад. QR — только пока событие не прошло по часам устройства.
 */
export function pickTicket(
  snapshot: OfflineSnapshot | null,
  owner: string | null,
  code: string,
  now: number,
): OfflineTicket | null {
  if (!snapshot || (owner !== null && snapshot.owner !== owner)) return null;
  const entry = snapshot.items[code];
  if (!entry || expired(entry, now)) return null;
  const over = eventEndsAtMs(entry.view.event) < now;
  return over ? { ...entry, view: { ...entry.view, qr: null, past: true } } : entry;
}
