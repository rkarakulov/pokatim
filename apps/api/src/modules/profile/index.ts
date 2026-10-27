export { ProfileCoreModule, ProfileModule } from './profile.module';
/** Порт для модуля `results`: публичные имена райдеров только с согласием (P1). */
export { RIDER_NAMES, type RiderNameDirectory } from './rider-names.port';
/** Порт для модуля `results` (race-results-07): пол и год анкеты Verified, фиксация в транзакции заявки. */
export {
  VERIFIED_PROFILES,
  type VerifiedDemographics,
  type VerifiedProfiles,
} from './verified-profiles.port';
/** Порт стирания профиля удалённого аккаунта и подпись субъекта `rider` в журнале панели (модуль `account`). */
export { ProfileErasure } from './profile-erasure';
export { riderSubjectLabel } from './profile-moderation.service';
