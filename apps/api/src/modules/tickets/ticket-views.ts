import type { MyTicketRef, TicketCategory } from '@pokatim/contracts';

import { eventSummary } from './ticket-events';
import type { TicketCategoryDoc, TicketDoc } from './tickets.collection';
import { type EventFacts, isPast, ticketStatus } from './tickets.policy';

/** Ссылка на свой билет: статус вычисляется по событию, `past` — окно check-in закрылось. */
export const ticketRef = (doc: TicketDoc, event: EventFacts, now: Date): MyTicketRef => ({
  code: doc.code,
  status: ticketStatus(doc, event),
  past: isPast(event, now),
  event: eventSummary(event),
});

/** Категория в ответе — явный список полей. */
export const categoryView = (category: TicketCategoryDoc | null): TicketCategory =>
  category === null
    ? null
    : category.kind === 'race'
      ? { kind: 'race', tier: category.tier, groupKey: category.groupKey }
      : { kind: 'calendar', distanceKm: category.distanceKm };
