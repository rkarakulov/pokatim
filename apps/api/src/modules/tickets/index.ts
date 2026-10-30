export { TicketsCoreModule, TicketsModule, TicketsWorkerModule } from './tickets.module';
export { ticketsOutboxRoutes } from './tickets.events';
/** Порт стирания для `account` (RC-T1, ADR-0015): регистрации и билеты удалённого → `cancelled`. */
export { TicketErasure } from './ticket-erasure';
/** Порт напоминаний для `notifications` (PR D) и событие outbox, на которое подписан приём уведомлений. */
export {
  TICKET_NOTICES,
  type TicketNotices,
  type TicketReminderNotice,
  type TicketReminderRef,
} from './ticket-notices.port';
export { TICKETS_REMINDER_DUE, TicketsReminderDue } from './tickets.events';
