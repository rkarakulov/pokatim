import type { AchievementCode, AchievementObjectKind } from '@pokatim/contracts';

import type { AchievementsGrantNoticed } from './achievements.events';
import type { LevelRank } from './achievements.policy';

/**
 * Порт `achievements` для `notifications` (achievements-push, через `modules/achievements/index.ts`): поля уведомления о
 * выдаче по событию `achievements.grant-noticed`. Получатель — владелец выдачи (не из payload); название объекта — из
 * фактов (тот же источник, что у `GET /v1/achievements`). `achievements` о `notifications` не знает.
 */
export const ACHIEVEMENT_NOTICES = Symbol('ACHIEVEMENT_NOTICES');

export interface AchievementNotice {
  userId: string;
  code: AchievementCode;
  /** объявленный ранг счётного; разовые и сезонные — `null` */
  level: LevelRank | null;
  /** объект факта: название своего объекта (гонка, маршрут, райд, сезон), без чужих ПДн (N12) */
  object: { kind: AchievementObjectKind; title: string };
  /** сезон сезонного достижения (цель `?season=`), иначе `null` */
  seasonId: string | null;
}

export interface AchievementNotices {
  /**
   * Нет выдачи (стёрт аккаунт) — `gone`; отозвана, ранг ниже объявленного, код больше не заработан или объекта нет —
   * `state` (о прежнем состоянии не сообщаем). Только чтение.
   */
  notice(event: AchievementsGrantNoticed, now: Date): Promise<AchievementNotice | 'gone' | 'state'>;
}
