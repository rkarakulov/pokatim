import type { ProtocolRowStatus, ResultGroupKey } from '@pokatim/contracts';

/**
 * Порт `results` для модуля `standings` (race-results-08, через `modules/results/index.ts`): текущие ревизии
 * опубликованных протоколов и строки снимка ревизии. `standings` коллекций `results` не читает; `results` о
 * `standings` не знает.
 */
export const RESULTS_FOR_STANDINGS = Symbol('RESULTS_FOR_STANDINGS');

/** Строка снимка протокола для зачёта сезона (только Verified-строки: START и «без пульса» в снимок не входят). */
export interface StandingsSourceRow {
  userId: string;
  place: number | null;
  tied: boolean;
  /** `final` | `revised` | `dq` */
  status: ProtocolRowStatus;
  /** ревизии до race-results-07 без группы — `overall` (RC-8 07) */
  groupKey: ResultGroupKey;
}

export interface ResultsForStandings {
  /**
   * Текущая ревизия протокола по гонкам — максимальная числовая `revision` журнала пересчётов (один `aggregate`,
   * RC-3); у гонки без ревизии ключа нет. Пустой вход — пустая карта без запроса.
   */
  currentRevisions(raceIds: readonly string[]): Promise<Map<string, number>>;
  /** Строки снимка ревизии всех групп, с DQ, по порядку протокола. */
  protocolRows(raceId: string, revision: number): Promise<StandingsSourceRow[]>;
}
