import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoOutboxWriter, uuidv7 } from '@rkarakulov/api-kit/mongo';

import { MongoTransactions } from '../../db';
import { dueReminders } from './reminders.policy';
import { TicketEvents } from './ticket-events';
import { type ReminderRuleDoc, ticketingIdOf } from './tickets.collection';
import { TICKETS_REMINDER_DUE, type TicketsReminderDue } from './tickets.events';
import type { EventFacts } from './tickets.policy';
import { TicketsRepository } from './tickets.repository';

const HOUR = 3_600_000;
/** Гонки в выборке — старт не дальше максимального `offsetHours` (168 ч). */
const LOOKAHEAD_MS = 168 * HOUR;

/** Итог регламента напоминаний. */
export interface TicketRemindersRun {
  dispatched: number;
  recipients: number;
  failed: number;
}

/**
 * Регламент напоминаний (`tickets.reminders`, PR D, RC-D2): события с включёнными билетами и правилами (RC-D11) →
 * `dueReminders` → на правило — транзакция: условный `$push` отправки (захват; 0 — уже отправлено параллельно или
 * раньше) → метки `remindersSent` билетам → число в отправке → outbox `tickets.reminder-due` (если кому-то ушло).
 * Уведомления пишет `notifications` (порт `TICKET_NOTICES`). Сбой события — лог, остальные идут, в конце — исключение.
 */
@Injectable()
export class TicketReminders {
  private readonly logger = new Logger(TicketReminders.name);

  constructor(
    private readonly repository: TicketsRepository,
    private readonly events: TicketEvents,
    private readonly transactions: MongoTransactions,
    private readonly outbox: MongoOutboxWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async dispatchDue(): Promise<TicketRemindersRun> {
    const now = this.clock.now();
    const run: TicketRemindersRun = { dispatched: 0, recipients: 0, failed: 0 };
    const settings = await this.repository.reminderTicketings(
      now,
      new Date(now.getTime() + LOOKAHEAD_MS),
    );
    if (settings.length === 0) return run;
    const facts = await this.events.resolveMany(
      settings.map((doc) => ({ kind: doc.kind, id: doc.eventId })),
    );
    for (const event of facts.values()) {
      const ticketing = event.ticketing;
      if (!ticketing) continue;
      try {
        const due = dueReminders(
          event,
          ticketing.reminders ?? [],
          ticketing.reminderDispatches ?? [],
          now,
        );
        for (const { rule, dueAt } of due) {
          const count = await this.dispatch(event, rule, dueAt, now);
          if (count === null) continue;
          run.dispatched += 1;
          run.recipients += count;
          this.logger.log(
            `tickets.reminder_dispatched event=${event.kind}:${event.id} reminder=${rule.id} count=${count}`,
          );
        }
      } catch (error) {
        run.failed += 1;
        this.logger.error(`tickets.reminders_failed event=${event.kind}:${event.id}`, error);
      }
    }
    if (run.failed > 0) throw new Error(`tickets.reminders: ${run.failed} event(s) failed`);
    return run;
  }

  /** Отправка правила по `dueAt`; `null` — захват не удался (уже отправлено или правило сменилось). */
  private dispatch(
    event: EventFacts,
    rule: ReminderRuleDoc,
    dueAt: Date,
    now: Date,
  ): Promise<number | null> {
    const ticketingId = ticketingIdOf(event.kind, event.id);
    return this.transactions.run(async (tx) => {
      const dispatchId = uuidv7();
      const claimed = await this.repository.claimReminderDispatch(
        tx,
        ticketingId,
        rule.offsetHours,
        {
          reminderId: rule.id,
          dueAt,
          dispatchId,
          at: now,
          count: 0,
        },
      );
      if (!claimed) return null;
      const count = await this.repository.markReminderSent(
        tx,
        event.kind,
        event.id,
        { reminderId: rule.id, dispatchId, at: now },
        dueAt,
      );
      await this.repository.setReminderDispatchCount(tx, ticketingId, dispatchId, count);
      if (count > 0) {
        const payload: TicketsReminderDue = {
          kind: event.kind,
          eventId: event.id,
          reminderId: rule.id,
          dispatchId,
        };
        await this.outbox.append(tx, { type: TICKETS_REMINDER_DUE, payload });
      }
      return count;
    });
  }
}
