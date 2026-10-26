import type { DbSession } from '../../db';

/**
 * Гейт споров для `results` (race-results-06, RC-1): интерфейс и токен объявляет `results`, реализацию даёт `disputes`
 * (`@Global DisputesCoreModule` в `AppModule` и `WorkerModule`). `results` коллекцию `disputes` не читает. Инъекция
 * обязательная: без регистрации сервис не стартует, а не выключает D-39 молча.
 */
export const RESULT_DISPUTE_GATE = Symbol('RESULT_DISPUTE_GATE');

export interface ResultDisputeGate {
  /** Открытые споры против заявки (D-39); в транзакции вызывающего — после его `lockEntry`. */
  openAgainst(entryId: string, session?: DbSession): Promise<number>;
  /** Открытые споры гонки (строка чек-листа публикации `open_disputes`). */
  openInRace(raceId: string, session?: DbSession): Promise<number>;
}
