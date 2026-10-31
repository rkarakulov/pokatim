import {
  type AchievementCode,
  type AchievementLevel,
  type AchievementObjectKind,
  isSeasonalCode,
  type SeasonalAchievementCode,
} from '@pokatim/contracts';

import type { FactAchievementCode } from './achievements.policy';

/**
 * Порт `achievements` для модуля `sharing` (карточка достижения, ADR-0018, через `modules/achievements/index.ts`):
 * своё **полученное** достижение — видимое в своём списке. `sharing` коллекций достижений не читает.
 */
export const ACHIEVEMENTS_FOR_SHARING = Symbol('ACHIEVEMENTS_FOR_SHARING');

/** Адрес карточки: несезонный — код; сезонный — код и сезон (S3: одна выдача на сезон). */
export type AchievementCardRef =
  | { code: FactAchievementCode; seasonId: null }
  | { code: SeasonalAchievementCode; seasonId: string };

/**
 * Адрес карточки из кода пути и `seasonId` запроса — одна функция для HTTP и worker: сезонный без сезона и несезонный
 * с сезоном — `null` (HTTP — 400).
 */
export function cardRef(code: AchievementCode, seasonId: string | null): AchievementCardRef | null {
  if (isSeasonalCode(code)) return seasonId === null ? null : { code, seasonId };
  return seasonId === null ? { code, seasonId } : null;
}

/**
 * Факты карточки: объект с названием из фактов владельца (сезонное — сезон и его название), дата факта (день по Минску,
 * RC-7; сезонное — последний день сезона) и текущий уровень (счётные; разовые и сезонные — `null`).
 */
export interface AchievementCardFacts {
  code: AchievementCode;
  object: { kind: AchievementObjectKind; id: string; title: string };
  factDate: string;
  level: AchievementLevel | null;
}

export interface AchievementsForSharing {
  /**
   * Своё достижение по адресу: несезонное — факт есть сейчас **и** выдача записана и не отозвана (как список
   * `GET /v1/achievements`); сезонное — выдача `(code, seasonId)` не отозвана и заработана по `final`-итогу сезона или
   * выдана вручную (C4; `pending` без ручной — нет). Иначе `null`. Сбой порта сезонов — исключение (не `null`, RC-5).
   * Только чтение — сверку и выдачу пишет `GET /v1/achievements`.
   */
  cardFacts(userId: string, ref: AchievementCardRef): Promise<AchievementCardFacts | null>;
}
