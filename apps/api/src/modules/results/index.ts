export { ResultsCoreModule, ResultsModule, ResultsWorkerModule } from './results.module';
export { resultsOutboxRoutes } from './results.events';
/** Перепроверка попыток гонки (запуск — панель протокола, race-results-05). */
export { ResultsRecheck } from './results-recheck';
/** Гейт D-39 и чек-листа (race-results-06): реализацию даёт `disputes`. */
export { RESULT_DISPUTE_GATE, type ResultDisputeGate } from './result-dispute-gate.port';
/** Порт для `disputes` (race-results-06): заявки, замок заявки, DQ до публикации, место цели. */
export {
  type DisputeEntry,
  type DisputeStanding,
  RESULTS_FOR_DISPUTES,
  type ResultsForDisputes,
} from './results-for-disputes.port';
