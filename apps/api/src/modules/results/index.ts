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
  type SeriesSegment,
} from './results-for-disputes.port';
/** Порт и события для `notifications` (ADR-0017): получатели уведомлений о результатах и протоколе. */
export { type AttemptNotice, RESULTS_NOTICES, type ResultsNotices } from './results-notices.port';
export {
  RESULTS_ATTEMPT_VERDICT_CHANGED,
  RESULTS_PROTOCOL_PUBLISHED,
  RESULTS_RESULT_REVISED,
  ResultsAttemptVerdictChanged,
  ResultsProtocolPublished,
  ResultsResultRevised,
} from './results.events';
/** Порт для `standings` (race-results-08): текущие ревизии протоколов и строки снимка ревизии. */
export {
  RESULTS_FOR_STANDINGS,
  type ResultsForStandings,
  type StandingsSourceRow,
} from './results-for-standings.port';
/** Порт для `sharing` (story-cards): факты своего результата и линия карточки для сторис. */
export {
  RESULTS_FOR_SHARING,
  type ResultsForSharing,
  type StoryCardFacts,
  type StoryCardLine,
  type StoryCardResultStatus,
} from './results-for-sharing.port';
/**
 * Порт для `riders` (rider-profile) и `achievements`: строки райдера в текущих ревизиях опубликованных протоколов,
 * названия гонок, предикат «в зачёте».
 */
export {
  isRankedRow,
  RIDER_RESULTS,
  RIDER_RESULTS_MAX_ROWS,
  type RiderFinishRow,
  type RiderProtocolRow,
  type RiderRaceInfo,
  type RiderResults,
} from './rider-results.port';
/** Порт «Обзора» панели (admin-overview): готовность протоколов и активность гонок; даёт `ResultsModule`. */
export { type ProtocolReadiness, ResultsOverview } from './results-overview';
