export { RidesCoreModule, RidesModule } from './rides.module';
export { RideErasure, type RideErasureResult } from './ride-erasure';
/** Порт и события для `notifications` (ADR-0016): поля текста и получатели уведомлений о райдах. */
export { RIDE_NOTICES, type RideNotice, type RideNotices } from './ride-notices.port';
export {
  RIDES_PARTICIPANT_JOINED,
  RIDES_REPORTS_RESOLVED,
  RIDES_RIDE_CANCELLED,
  RIDES_RIDE_RESCHEDULED,
  RideEventPayload,
  RidesReportsResolved,
} from './rides.events';
