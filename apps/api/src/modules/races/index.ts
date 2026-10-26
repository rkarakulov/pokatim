export { RacesCoreModule, RacesModule } from './races.module';
/** Порт для модуля `results`: гонка, окно, коридор, фиксация V-12, видимость в панели. */
export { RACE_REGISTRY, type RaceForResults, type RaceRegistry } from './race-registry.port';
/** Гейт D-19 (race-results-06): реализацию даёт `disputes`. */
export { RACE_CANCEL_GATE, type RaceCancelGate } from './race-cancel-gate.port';
