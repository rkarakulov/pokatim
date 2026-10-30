/** Рейтинг сезона (race-results-08): снимок таблиц «класс × группа», регламент пересчёта, чтения. */
export { StandingsCoreModule, StandingsModule, StandingsWorkerModule } from './standings.module';
/** Порт итогов райдера по завершённым сезонам для `achievements` (achievements-seasonal). */
export {
  RIDER_SEASON_STANDINGS,
  type RiderSeasonOutcome,
  type RiderSeasonRow,
  type RiderSeasonStandings,
} from './rider-season-standings.port';
