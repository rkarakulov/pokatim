/** Профиль райдера (rider-profile): статистика своего профиля и публичный профиль по `publicId`. */
export { RidersCoreModule, RidersModule } from './riders.module';
/** Порт OG-картинки профиля для `sharing` (og-rider-season-dark): публичная статистика без ПДн. */
export {
  type RiderOgFacts,
  RIDERS_FOR_SHARING,
  type RidersForSharing,
} from './riders-for-sharing.port';
