/**
 * Порт `profile` для модуля `riders` (rider-profile, через `modules/profile/index.ts`): публичный профиль райдера по
 * непрозрачному `publicId` — только при имени и согласии на показ (условие — в фильтре запроса).
 */
export const RIDER_PROFILES = Symbol('RIDER_PROFILES');

export interface PublicRiderRecord {
  /** только для портов других модулей (результаты, заезды); наружу не выходит */
  userId: string;
  publicName: string;
  club: string | null;
  avatarId: string | null;
}

export interface RiderProfileDirectory {
  /** Нет, имени нет или согласие отозвано — `null`. */
  findPublic(publicId: string): Promise<PublicRiderRecord | null>;
}
