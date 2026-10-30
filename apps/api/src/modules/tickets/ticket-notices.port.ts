import type { TicketEventKind } from '@pokatim/contracts';

/**
 * Порт `tickets` для `notifications` (PR D, через `modules/tickets/index.ts`): поля текста и получатели напоминания о
 * событии. `notifications` коллекции билетов не читает; наружу — название, время, место, текст правила организатора,
 * `userId` и код билета (цель уведомления), без e-mail и токенов.
 */
export const TICKET_NOTICES = Symbol('TICKET_NOTICES');

export interface TicketReminderRef {
  kind: TicketEventKind;
  eventId: string;
  reminderId: string;
  dispatchId: string;
}

export interface TicketReminderNotice {
  event: { title: string; startsAt: Date; place: string | null };
  text: string;
  recipients: { userId: string; code: string }[];
}

export interface TicketNotices {
  /**
   * Напоминание к приёму: нет события или правила — `gone`; событие не `scheduled` или уже началось — `state`;
   * иначе — активные билеты с меткой этой отправки.
   */
  reminder(ref: TicketReminderRef, now: Date): Promise<TicketReminderNotice | 'gone' | 'state'>;
}
