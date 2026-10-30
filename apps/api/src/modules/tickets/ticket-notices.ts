import { Injectable } from '@nestjs/common';

import type { TicketNotices, TicketReminderNotice, TicketReminderRef } from './ticket-notices.port';
import { TicketEvents } from './ticket-events';
import { TicketsRepository } from './tickets.repository';

/** Реализация `TICKET_NOTICES` (Core): факты события — `TicketEvents`, получатели — метка `remindersSent.dispatchId`. */
@Injectable()
export class TicketNoticesService implements TicketNotices {
  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
  ) {}

  async reminder(
    ref: TicketReminderRef,
    now: Date,
  ): Promise<TicketReminderNotice | 'gone' | 'state'> {
    const event = await this.events.resolve(ref.kind, ref.eventId);
    const rule = event?.ticketing?.reminders?.find((item) => item.id === ref.reminderId);
    if (!event || !rule) return 'gone';
    if (event.state !== 'scheduled' || now >= event.startsAt) return 'state';
    const recipients = await this.repository.reminderRecipients(
      ref.kind,
      ref.eventId,
      ref.dispatchId,
    );
    return {
      event: { title: event.title, startsAt: event.startsAt, place: event.place },
      text: rule.text,
      recipients: recipients.map(({ userId, code }) => ({ userId, code })),
    };
  }
}
