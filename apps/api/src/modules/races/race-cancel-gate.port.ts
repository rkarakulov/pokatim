import type { DbSession } from '../../db';

/**
 * Гейт споров для `races` (race-results-06, D-19, RC-1/RC-9): интерфейс и токен объявляет `races`, реализацию даёт
 * `disputes` (`@Global DisputesCoreModule`). `races` коллекцию `disputes` не читает. Инъекция обязательная.
 */
export const RACE_CANCEL_GATE = Symbol('RACE_CANCEL_GATE');

export interface RaceCancelGate {
  /** Открытые споры гонки — в транзакции отмены. */
  openDisputes(raceId: string, session?: DbSession): Promise<number>;
  /** Открытые споры по гонкам страницы (одна агрегация); гонки без споров в карте отсутствуют. */
  openDisputesByRace(raceIds: readonly string[]): Promise<Map<string, number>>;
}
