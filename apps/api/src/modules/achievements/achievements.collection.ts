import type { AchievementObjectKind, SeasonalAchievementCode } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

import type { FactAchievementCode, LevelRank } from './achievements.policy';

/**
 * Коллекции модуля `achievements` — выдачи достижений, производная проекция фактов (`results`, `route-rides`,
 * `rides`), ADR-0020. Создаёт миграция `0035_achievements`; единственный писатель — `AchievementsRepository`. Не
 * append-only: отзыв — поле `revokedAt`, стирание аккаунта — `deleteMany`. Сезонные выдачи — `achievement_season_grants`
 * (`0043_achievements_seasonal`, HG-S1), источник — порт `standings` `RIDER_SEASON_STANDINGS`. Названия объектов не хранятся (берутся из
 * фактов при ответе: переименование видно сразу, чужие данные не копируются).
 */
export const ACHIEVEMENTS_COLLECTIONS = {
  grants: 'achievement_grants',
  seasonGrants: 'achievement_season_grants',
  syncs: 'achievement_syncs',
} as const;

/** Выдача: один документ на `(userId, code)` (уникальный индекс `achievement_grants_user_code_unique`). */
export interface AchievementGrantDoc {
  _id: string;
  userId: string;
  code: FactAchievementCode;
  /** объект факта — пересчитывается каждой сверкой (A4) */
  object: { kind: Exclude<AchievementObjectKind, 'season'>; id: string };
  /** время факта (старт сегмента, активности, райда) */
  factAt: Date;
  grantedAt: Date;
  /** показано вспышкой; первая сверка выдаёт сразу просмотренным (A3); восстановление не сбрасывает (A4) */
  seenAt: Date | null;
  /** факт пропал — скрыто из списка, вспышки и публичного профиля (A4) */
  revokedAt: Date | null;
  /** ранг уровня счётного (1–3), пересчитывается сверкой; разовые — `null`; нет у документов v1 — ≡ 1 */
  level?: LevelRank | null;
  /** наибольший показанный ранг (монотонен, `$max`); нет у документов v1 — ≡ 1 (L3) */
  seenLevel?: LevelRank | null;
  /**
   * наибольший ранг, о котором создано событие `achievements.grant-noticed` (achievements-push, монотонен, `$max`);
   * ставится каждой вставкой (`= level`) и каждым `refresh`/`restore`; нет у документов до выката — ≡ `level ?? 1`
   * (ретро-уведомлений нет)
   */
  notifiedLevel?: LevelRank | null;
  updatedAt: Date;
}

/**
 * Сезонная выдача (S3): один документ на `(userId, code, seasonId)` (уникальный индекс
 * `achievement_season_grants_user_code_season_unique`). Названия сезона и места нет — название берётся из порта при
 * каждом ответе. Не append-only.
 */
export interface AchievementSeasonGrantDoc {
  /** uuidv7 */
  _id: string;
  userId: string;
  code: SeasonalAchievementCode;
  seasonId: string;
  /** последний миг сезона (`endsBefore − 1 мс`, RC-S6) */
  factAt: Date;
  grantedAt: Date;
  /** показано вспышкой; первая сверка — сразу (A3/S5); восстановление не сбрасывает (S4) */
  seenAt: Date | null;
  /** итог сезона изменился — скрыто (S4) */
  revokedAt: Date | null;
  updatedAt: Date;
}

/** Маркер «первая сверка выполнена» (RC-1): ставится после записи выдач первой сверки. */
export interface AchievementSyncDoc {
  _id: string;
  firstSyncAt: Date;
}

export interface AchievementsCollections {
  grants: Collection<AchievementGrantDoc>;
  seasonGrants: Collection<AchievementSeasonGrantDoc>;
  syncs: Collection<AchievementSyncDoc>;
}

export function achievementsCollections(db: Db): AchievementsCollections {
  return {
    grants: db.collection<AchievementGrantDoc>(ACHIEVEMENTS_COLLECTIONS.grants),
    seasonGrants: db.collection<AchievementSeasonGrantDoc>(ACHIEVEMENTS_COLLECTIONS.seasonGrants),
    syncs: db.collection<AchievementSyncDoc>(ACHIEVEMENTS_COLLECTIONS.syncs),
  };
}
