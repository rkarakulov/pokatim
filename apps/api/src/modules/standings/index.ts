/** Рейтинг сезона (race-results-08): снимок таблиц «класс × группа», регламент пересчёта, чтения. */
export { StandingsCoreModule, StandingsModule, StandingsWorkerModule } from './standings.module';
/** Подписка на события протокола `results` (тип → `standings-recalc`), подключает `src/outbox-routes.ts`. */
export { standingsOutboxRoutes } from './standings.events';
/** Порт итогов райдера по завершённым сезонам для `achievements` (achievements-seasonal). */
export {
  RIDER_SEASON_STANDINGS,
  type RiderSeasonOutcome,
  type RiderSeasonRow,
  type RiderSeasonStandings,
} from './rider-season-standings.port';
