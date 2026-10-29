export { CalendarCoreModule, CalendarModule } from './calendar.module';
/** Порт «Обзора» панели (admin-overview): ближайшие старты календаря. */
export { type CalendarOverviewStart, CalendarOverview } from './calendar-overview';
/** Порт OG-картинки старта для `sharing` (og-images): факты опубликованного старта и пререндер. */
export {
  CALENDAR_FOR_SHARING,
  type CalendarForSharing,
  type CalendarOgFacts,
} from './calendar-for-sharing.port';
/** Порт для `tickets` (event-tickets): факты старта для регистрации и билетов. */
export {
  CALENDAR_EVENTS,
  type CalendarEventFacts,
  type CalendarEvents,
} from './calendar-events.port';
