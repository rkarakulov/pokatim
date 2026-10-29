/** Достижения райдера (achievements, ADR-0020): каталог v1, выдача сверкой при чтении, публичные гоночные. */
export {
  AchievementsCoreModule,
  AchievementsModule,
  AchievementsReadModule,
} from './achievements.module';
/** Порт карточки достижения для `sharing` (ADR-0018): своё полученное достижение. */
export {
  ACHIEVEMENTS_FOR_SHARING,
  type AchievementCardFacts,
  type AchievementsForSharing,
} from './achievements-for-sharing.port';
/** Порт стирания достижений удалённого аккаунта (модуль `account`). */
export { AchievementErasure } from './achievement-erasure';
