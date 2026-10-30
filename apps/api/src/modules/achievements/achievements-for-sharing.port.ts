import type { AchievementCode, AchievementLevel, AchievementObjectKind } from '@pokatim/contracts';

/**
 * Порт `achievements` для модуля `sharing` (карточка достижения, ADR-0018, через `modules/achievements/index.ts`):
 * своё **полученное** достижение — видимое в своём списке. `sharing` коллекций достижений не читает.
 */
export const ACHIEVEMENTS_FOR_SHARING = Symbol('ACHIEVEMENTS_FOR_SHARING');

/**
 * Факты карточки: объект с названием из фактов владельца, дата факта (день по Минску, RC-7) и текущий уровень (счётные;
 * разовые — `null`).
 */
export interface AchievementCardFacts {
  code: AchievementCode;
  object: { kind: AchievementObjectKind; id: string; title: string };
  factDate: string;
  level: AchievementLevel | null;
}

export interface AchievementsForSharing {
  /**
   * Своё достижение: факт есть сейчас **и** выдача записана и не отозвана (как список `GET /v1/achievements`); иначе
   * `null`. Только чтение — сверку и выдачу пишет `GET /v1/achievements`.
   */
  cardFacts(userId: string, code: AchievementCode): Promise<AchievementCardFacts | null>;
}
