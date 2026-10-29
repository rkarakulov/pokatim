import { z } from 'zod';

import { QUEUE } from '../../queues';

/**
 * Билет выпущен (event-tickets): письмо «Вы зарегистрированы». Пишется в транзакции выпуска (ленивое чтение, сверка,
 * регистрация календаря); jobId задачи = id события, одно письмо на билет — захват в документе билета (RC-T11).
 */
export const TICKETS_ISSUED = 'tickets.issued';
export const TicketsIssued = z.object({ ticketId: z.uuid() });
export type TicketsIssued = z.infer<typeof TicketsIssued>;

/** Маршруты outbox модуля (composition root — `worker.module.ts`). */
export const ticketsOutboxRoutes = { [TICKETS_ISSUED]: QUEUE.ticketsEmail } as const;
