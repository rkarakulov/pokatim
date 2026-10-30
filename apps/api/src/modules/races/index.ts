export { RacesCoreModule, RacesModule } from './races.module';
/** Порт для модуля `results`: гонка, окно, коридор, фиксация V-12, видимость в панели. */
export { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from './race-registry.port';
/** Гейт D-19 (race-results-06): реализацию даёт `disputes`. */
export { RACE_CANCEL_GATE, type RaceCancelGate } from './race-cancel-gate.port';
/** Порт для модуля `standings` (race-results-08): гонки сезона с протоколом, сезон, видимость гонок сотруднику. */
export { SEASON_RACES, type SeasonRaceForStandings, type SeasonRaces } from './season-races.port';
/** Порт OG-картинок гонки и сезона для `sharing` (og-images): факты, пререндер, «живые» сезоны. */
export {
  type RaceOgFacts,
  RACES_FOR_SHARING,
  type RacesForSharing,
  type SeasonOgFacts,
} from './races-for-sharing.port';
/** Порт «Обзора» панели (admin-overview): гонки с открытым окном и ждущие протокола. */
export { type OverviewRaces, RacesOverview } from './races-overview';
