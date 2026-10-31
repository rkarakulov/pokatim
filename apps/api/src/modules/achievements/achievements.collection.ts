import type { AchievementCode, AchievementObjectKind } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

import type { LevelRank } from './achievements.policy';

/**
 * Коллекции модуля `achievements` — выдачи достижений, производная проекция фактов (`results`, `route-rides`,
 * `rides`), ADR-0020. Создаёт миграция `0035_achievements`; единственный писатель — `AchievementsRepository`. Не
 * append-only: отзыв — поле `revokedAt`, стирание аккаунта — `deleteMany`. Названия объектов не хранятся (берутся из
 * фактов при ответе: переименование видно сразу, чужие данные не копируются).
 */
export const ACHIEVEMENTS_COLLECTIONS = {
  grants: 'achievement_grants',
  syncs: 'achievement_syncs',
} as const;

/** Выдача: один документ на `(userId, code)` (уникальный индекс `achievement_grants_user_code_unique`). */
export interface AchievementGrantDoc {
  _id: string;
  userId: string;
  code: AchievementCode;
  /** объект факта — пересчитывается каждой сверкой (A4) */
  object: { kind: AchievementObjectKind; id: string };
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
  updatedAt: Date;
}

/** Маркер «первая сверка выполнена» (RC-1): ставится после записи выдач первой сверки. */
export interface AchievementSyncDoc {
  _id: string;
  firstSyncAt: Date;
}

export interface AchievementsCollections {
  grants: Collection<AchievementGrantDoc>;
  syncs: Collection<AchievementSyncDoc>;
}

export function achievementsCollections(db: Db): AchievementsCollections {
  return {
    grants: db.collection<AchievementGrantDoc>(ACHIEVEMENTS_COLLECTIONS.grants),
    syncs: db.collection<AchievementSyncDoc>(ACHIEVEMENTS_COLLECTIONS.syncs),
  };
}
