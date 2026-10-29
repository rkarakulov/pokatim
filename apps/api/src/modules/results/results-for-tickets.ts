import { Injectable } from '@nestjs/common';

import type { RaceEntryDoc } from './results.collection';
import type { ResultsForTickets, TicketEntry } from './results-for-tickets.port';
import { ResultsRepository } from './results.repository';

const toTicketEntry = (
  doc: Pick<RaceEntryDoc, '_id' | 'raceId' | 'userId' | 'status' | 'tier' | 'groupKey'>,
): TicketEntry => ({
  entryId: doc._id,
  raceId: doc.raceId,
  userId: doc.userId,
  status: doc.status,
  tier: doc.tier ?? 'verified',
  groupKey: doc.groupKey ?? 'overall',
});

/** Реализация порта `ResultsForTickets` (event-tickets): только чтение заявок через `ResultsRepository`. */
@Injectable()
export class ResultsForTicketsService implements ResultsForTickets {
  constructor(private readonly repository: ResultsRepository) {}

  async entryOf(userId: string, raceId: string): Promise<TicketEntry | null> {
    const doc = await this.repository.findEntry(raceId, userId);
    return doc ? toTicketEntry(doc) : null;
  }

  async entriesPage(raceId: string, afterId: string | null, limit: number): Promise<TicketEntry[]> {
    return (await this.repository.entriesPageOfRace(raceId, afterId, limit)).map(toTicketEntry);
  }
}
