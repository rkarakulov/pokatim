/** Достижения райдера (achievements, ADR-0020): каталог v1, выдача сверкой при чтении, публичные гоночные. */
export {
  AchievementsCoreModule,
  AchievementsModule,
  AchievementsReadModule,
  AchievementsSyncModule,
} from './achievements.module';
/** Событие о выдаче для уведомлений (achievements-push) и порт полей уведомления для `notifications`. */
export {
  ACHIEVEMENTS_GRANT_NOTICED,
  AchievementsGrantNoticed,
  type ReconcileOrigin,
} from './achievements.events';
export {
  ACHIEVEMENT_NOTICES,
  type AchievementNotice,
  type AchievementNotices,
} from './achievement-notices.port';
/** Ранг уровня счётного (1–3) — текст уведомления о новом уровне. */
export { type LevelRank, levelName } from './achievements.policy';
/** Порт карточки достижения для `sharing` (ADR-0018): своё полученное достижение. */
export {
  ACHIEVEMENTS_FOR_SHARING,
  type AchievementCardFacts,
  type AchievementsForSharing,
} from './achievements-for-sharing.port';
/** Несезонные коды (у них есть карточка и значок; сезонные — `RIDER_SEASON_STANDINGS`, без карточки, S7). */
export type { FactAchievementCode } from './achievements.policy';
/** Порт стирания достижений удалённого аккаунта (модуль `account`). */
export { AchievementErasure } from './achievement-erasure';
