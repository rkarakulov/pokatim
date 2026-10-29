import { Injectable } from '@nestjs/common';

import type { CalendarStartDoc } from './calendar.collection';
import type { CalendarEventFacts, CalendarEvents } from './calendar-events.port';
import { CalendarRepository } from './calendar.repository';

const toFacts = (doc: CalendarStartDoc): CalendarEventFacts => ({
  id: doc._id,
  status: doc.status,
  title: doc.title,
  startsOn: doc.startsOn,
  endsOn: doc.endsOn,
  startTime: doc.startTime,
  city: doc.city,
  place: doc.place,
  distancesKm: doc.distancesKm,
});

/** Реализация порта `CalendarEvents` (event-tickets): только чтение через `CalendarRepository`. */
@Injectable()
export class CalendarEventsService implements CalendarEvents {
  constructor(private readonly repository: CalendarRepository) {}

  async get(id: string): Promise<CalendarEventFacts | null> {
    const doc = await this.repository.find(id);
    return doc ? toFacts(doc) : null;
  }

  async getMany(ids: readonly string[]): Promise<Map<string, CalendarEventFacts>> {
    const docs = await this.repository.findMany(ids);
    return new Map(docs.map((doc) => [doc._id, toFacts(doc)] as const));
  }
}
