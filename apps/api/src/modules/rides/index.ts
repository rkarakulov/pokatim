export { RidesCoreModule, RidesModule } from './rides.module';
export { RideErasure, type RideErasureResult } from './ride-erasure';
/** Порт и события для `notifications` (ADR-0017): поля текста и получатели уведомлений о райдах. */
export { RIDE_NOTICES, type RideNotice, type RideNotices } from './ride-notices.port';
export {
  RIDES_PARTICIPANT_JOINED,
  RIDES_REPORTS_RESOLVED,
  RIDES_RIDE_CANCELLED,
  RIDES_RIDE_RESCHEDULED,
  RideEventPayload,
  RidesReportsResolved,
} from './rides.events';
/** Порт карточки-приглашения для `sharing` (ADR-0018): публичные факты будущего райда и линия маршрута каталога. */
export {
  type RideInviteFacts,
  RIDES_FOR_SHARING,
  type RidesForSharing,
} from './rides-for-sharing.port';
/** Порт для `achievements`: прошедшие райды райдера (условия R8). */
export {
  RIDER_RIDES,
  RIDER_RIDES_MAX_ROWS,
  type RiderRideFact,
  type RiderRideInfo,
  type RiderRides,
} from './rider-rides.port';
/** Порт «Обзора» панели (admin-overview): райды с открытыми жалобами и активные райды. */
export { RidesOverview } from './rides-overview';
/**
 * Порт для `social` («Свои», ADR-0027): факты райда для явки — фаза, старт, участники, точная точка старта; P5 — райды
 * участника по окну старта и начавшиеся райды для «Как прошёл райд?».
 */
export {
  RIDES_FOR_SOCIAL,
  type RidesForSocial,
  type SocialRideFacts,
  type SocialStartedRide,
} from './rides-for-social.port';
