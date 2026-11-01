export { ProfileCoreModule, ProfileModule } from './profile.module';
/**
 * Порт для модулей `results`, `routes`, `route-rides`: публичные имена райдеров только с согласием (P1); райдеры с
 * согласием на показ заездов (route-rides-04).
 */
export {
  type PublicRiderCard,
  RIDER_NAMES,
  type RiderNameDirectory,
  riderRowFields,
  type RouteRideRiders,
} from './rider-names.port';
/** Порт для модуля `results` (race-results-07): пол и год анкеты Verified, фиксация в транзакции заявки. */
export {
  VERIFIED_PROFILES,
  type VerifiedDemographics,
  type VerifiedProfiles,
} from './verified-profiles.port';
/** Порт стирания профиля удалённого аккаунта и подпись субъекта `rider` в журнале панели (модуль `account`). */
export { ProfileErasure } from './profile-erasure';
export { riderSubjectLabel } from './profile-moderation.service';
/** Порт для модуля `riders` (rider-profile): публичный профиль по `publicId` — только при имени и согласии. */
export {
  type PublicRiderRecord,
  RIDER_PROFILES,
  type RiderProfileDirectory,
} from './rider-profiles.port';
/** Порт для модуля `sharing` (user-theme): личная тема создателя карточки; нет выбора — «Классика». */
export { RIDER_THEMES, type RiderThemes } from './rider-themes.port';
/** Порт «Обзора» панели (admin-overview): профили с открытыми жалобами. */
export { ProfilesOverview } from './profiles-overview';
export { ReservedRiderLines } from './reserved-rider-lines';
/** Событие для `notifications` (profile-moderation-followups): модератор сбросил поле профиля. */
export { PROFILE_FIELD_RESET, ProfileFieldReset } from './profile.events';
/** Событие для `notifications` (profile-moderation-d11): модератор закрыл жалобы на профиль — авторам жалоб. */
export { PROFILE_REPORTS_RESOLVED, ProfileReportsResolved } from './profile.events';
