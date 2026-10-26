export { ResultsCoreModule, ResultsModule, ResultsWorkerModule } from './results.module';
export { resultsOutboxRoutes } from './results.events';
/** Перепроверка попыток гонки — механизм для слайса 05 (запуск и журнал пересчётов там). */
export { ResultsRecheck } from './results-recheck';
