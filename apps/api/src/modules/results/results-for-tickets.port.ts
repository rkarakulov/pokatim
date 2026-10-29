import type { EntryTier, RaceEntryStatus, ResultGroupKey } from '@pokatim/contracts';

import type { DbSession } from '../../db';

/**
 * Порт `results` для модуля `tickets` (event-tickets, через `modules/results/index.ts`): заявка райдера и заявки гонки
 * пачками — для выпуска и сверки билетов гонки. `tickets` коллекций `race_entries` не читает; `results` о билетах не
 * знает.
 */
export const RESULTS_FOR_TICKETS = Symbol('RESULTS_FOR_TICKETS');

/** Заявка для билета: без попыток и результата. Заявки до race-results-07 — `tier ?? 'verified'`. */
export interface TicketEntry {
  entryId: string;
  raceId: string;
  userId: string;
  status: RaceEntryStatus;
  tier: EntryTier;
  groupKey: ResultGroupKey;
}

export interface ResultsForTickets {
  /** Заявка райдера на гонку (активная или снятая); нет — `null`. */
  entryOf(userId: string, raceId: string): Promise<TicketEntry | null>;
  /** Заявки гонки по `_id` ↑ после `afterId` (`null` — с начала), не больше `limit`. */
  entriesPage(raceId: string, afterId: string | null, limit: number): Promise<TicketEntry[]>;
  /**
   * Замок заявки в транзакции check-in (`lockEntry` — запись в документ заявки, как у отмены участия): отметка и отмена
   * участия сериализуются конфликтом записи. Статус заявки на снимке транзакции; нет заявки — `null`.
   */
  lockEntryForTicket(tx: DbSession, entryId: string, now: Date): Promise<RaceEntryStatus | null>;
}
