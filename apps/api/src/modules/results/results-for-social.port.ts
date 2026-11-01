/**
 * Порт `results` для модуля `social` («Свои» P4, через `modules/results/index.ts`): строка публичной таблицы гонки —
 * цель «Респекта» (K8); P7 — свежие результаты «своих» для Главной. `social` коллекций `race_entries` и снимков протокола не читает; `results` о `social` не знает.
 */
export const RESULTS_FOR_SOCIAL = Symbol('RESULTS_FOR_SOCIAL');

/** Строка публичной таблицы гонки — цель «Респекта» (K8). Без имён; `ownerUserId` наружу не выходит. */
export interface RaceEntryRespectTarget {
  entryId: string;
  raceId: string;
  ownerUserId: string;
}

/** Строка опубликованного протокола «своего» за окно (Главная «Свои», social-p7); `userId` наружу не выходит. */
export interface SocialRaceResult {
  raceId: string;
  raceTitle: string;
  publishedAt: Date;
  entryId: string;
  userId: string;
  place: number;
  tied: boolean;
  elapsedSec: number;
  /** видимая строка зрителя той же ревизии и группы; нет — `null` */
  viewerElapsedSec: number | null;
}

export interface ResultsForSocial {
  /**
   * Видна в публичной таблице сейчас (до публикации — живые места, после — текущая ревизия, RC-P4-1); снятая, DQ,
   * финишёр без места, черновик, отменённая гонка, неизвестная — `null`.
   */
  respectTarget(entryId: string): Promise<RaceEntryRespectTarget | null>;
  /**
   * Главная «Свои» (K7, social-p7): видимые строки опубликованных протоколов `userIds` (без зрителя), протокол не
   * старше `since`; протокол ↓, гонка ↑, место ↑, заявка ↑; ≤ `limit`. Предварительная таблица — не источник.
   */
  recentResults(
    userIds: readonly string[],
    viewerId: string,
    since: Date,
    limit: number,
  ): Promise<SocialRaceResult[]>;
}
