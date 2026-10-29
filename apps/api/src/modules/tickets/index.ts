export { TicketsCoreModule, TicketsModule, TicketsWorkerModule } from './tickets.module';
export { ticketsOutboxRoutes } from './tickets.events';
/** Порт стирания для `account` (RC-T1, ADR-0015): регистрации и билеты удалённого → `cancelled`. */
export { TicketErasure } from './ticket-erasure';
