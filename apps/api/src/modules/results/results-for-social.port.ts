/**
 * Порт `results` для модуля `social` («Свои» P4, через `modules/results/index.ts`): строка публичной таблицы гонки —
 * цель «Респекта» (K8). `social` коллекций `race_entries` и снимков протокола не читает; `results` о `social` не знает.
 */
export const RESULTS_FOR_SOCIAL = Symbol('RESULTS_FOR_SOCIAL');

/** Строка публичной таблицы гонки — цель «Респекта» (K8). Без имён; `ownerUserId` наружу не выходит. */
export interface RaceEntryRespectTarget {
  entryId: string;
  raceId: string;
  ownerUserId: string;
}

export interface ResultsForSocial {
  /**
   * Видна в публичной таблице сейчас (до публикации — живые места, после — текущая ревизия, RC-P4-1); снятая, DQ,
   * финишёр без места, черновик, отменённая гонка, неизвестная — `null`.
   */
  respectTarget(entryId: string): Promise<RaceEntryRespectTarget | null>;
}
