import { z } from 'zod';

import { QUEUE } from '../../queues';

/**
 * Билет выпущен (event-tickets): письмо «Вы зарегистрированы». Пишется в транзакции выпуска (ленивое чтение, сверка,
 * регистрация календаря); jobId задачи = id события, одно письмо на билет — захват в документе билета (RC-T11).
 */
export const TICKETS_ISSUED = 'tickets.issued';
export const TicketsIssued = z.object({ ticketId: z.uuid() });
export type TicketsIssued = z.infer<typeof TicketsIssued>;

/**
 * Правило напоминания отправлено (PR D, RC-D2): одно событие на (событие, правило, отправку), не на билет; получатели —
 * билеты с меткой `remindersSent.dispatchId` (порт `TICKET_NOTICES`). Маршрут объявляет подписчик
 * (`notificationsOutboxRoutes` → `notifications-intake`); payload — только id.
 */
export const TICKETS_REMINDER_DUE = 'tickets.reminder-due';
export const TicketsReminderDue = z.object({
  kind: z.enum(['race', 'calendar']),
  eventId: z.uuid(),
  reminderId: z.uuid(),
  dispatchId: z.uuid(),
});
export type TicketsReminderDue = z.infer<typeof TicketsReminderDue>;

/** Маршруты outbox модуля (composition root — `worker.module.ts`). */
export const ticketsOutboxRoutes = { [TICKETS_ISSUED]: QUEUE.ticketsEmail } as const;
