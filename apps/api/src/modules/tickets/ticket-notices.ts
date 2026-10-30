import { Inject, Injectable } from '@nestjs/common';

import { RESULTS_FOR_TICKETS, type ResultsForTickets } from '../results';

import type { TicketNotices, TicketReminderNotice, TicketReminderRef } from './ticket-notices.port';
import { TicketEvents } from './ticket-events';
import { TICKETS_POLICY } from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

/**
 * Реализация `TICKET_NOTICES` (Core): факты события — `TicketEvents`, получатели — метка `remindersSent.dispatchId`.
 * Гонка — только билеты активных заявок (`RESULTS_FOR_TICKETS`): участие могли снять после метки, до сверки (ревью
 * pass 1, AC10).
 */
@Injectable()
export class TicketNoticesService implements TicketNotices {
  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    @Inject(RESULTS_FOR_TICKETS) private readonly results: ResultsForTickets,
  ) {}

  /** Активные заявки гонки (id), пачками по `reconcileBatch`. */
  private async activeEntries(raceId: string): Promise<Set<string>> {
    const active = new Set<string>();
    let afterId: string | null = null;
    for (;;) {
      const page = await this.results.entriesPage(raceId, afterId, TICKETS_POLICY.reconcileBatch);
      for (const entry of page) if (entry.status === 'active') active.add(entry.entryId);
      if (page.length < TICKETS_POLICY.reconcileBatch) return active;
      afterId = page.at(-1)!.entryId;
    }
  }

  async reminder(
    ref: TicketReminderRef,
    now: Date,
  ): Promise<TicketReminderNotice | 'gone' | 'state'> {
    const event = await this.events.resolve(ref.kind, ref.eventId);
    const rule = event?.ticketing?.reminders?.find((item) => item.id === ref.reminderId);
    if (!event || !rule) return 'gone';
    if (event.state !== 'scheduled' || now >= event.startsAt) return 'state';
    let recipients = await this.repository.reminderRecipients(
      ref.kind,
      ref.eventId,
      ref.dispatchId,
    );
    if (ref.kind === 'race' && recipients.length > 0) {
      const active = await this.activeEntries(ref.eventId);
      recipients = recipients.filter((ticket) => active.has(ticket.registrationId));
    }
    return {
      event: { title: event.title, startsAt: event.startsAt, place: event.place },
      text: rule.text,
      recipients: recipients.map(({ userId, code }) => ({ userId, code })),
    };
  }
}
