import type { BikeClass, RaceCancelReason, RaceStatus, Surface } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `races` — сезоны и гонки (ADR-0010, R1). Создаёт миграция `0007_races`; единственный писатель —
 * `RacesRepository`. Время — BSON `Date` (UTC) из `CLOCK`, nullable — явным `null`.
 */
export const RACES_COLLECTIONS = { seasons: 'seasons', races: 'races', meta: 'race_meta' } as const;

/**
 * Сезон: календарные даты Минска (`startsOn`, `endsOn` включительно) и границы-моменты для запросов — `startsAt`
 * (00:00 Минска дня начала), `endsBefore` (00:00 Минска дня после конца). Статуса нет — фаза по `CLOCK`.
 */
export interface SeasonDoc {
  _id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  startsAt: Date;
  endsBefore: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/**
 * Гонка по коридору. Окно `[windowStartsAt, windowEndsAt]` включает последнюю минуту (R12). `seasonId` — только у
 * опубликованной (черновик без сезона, R9). `corridor` — эталонный коридор (race-results-01): маршрут `routes`, допуск
 * и снимок длины маршрута; `null` — гонка-анонс. Документы до миграции `0013_routes` поля не имеют (чтение — `?? null`).
 */
export interface RaceDoc {
  _id: string;
  ownerUserId: string;
  status: RaceStatus;
  title: string;
  bikeClass: BikeClass;
  surfaces: Surface[];
  distanceKm: number;
  description: string | null;
  windowStartsAt: Date;
  windowEndsAt: Date;
  protocolPlannedAt: Date;
  seasonId: string | null;
  cancelReason: RaceCancelReason | null;
  corridor: RaceCorridor | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  /**
   * Момент первой заявки участника (race-results-03, V-12): коридор, окно, класс и покрытия больше не меняются.
   * Пишет только `RacesRepository.admitEntry` (порт `RaceRegistry`); документы до `0015_results` — `?? null`.
   */
  lockedAt: Date | null;
  /**
   * Счётчик заявок (race-results-03): `admitEntry` увеличивает его каждой заявкой — запись в документ гонки
   * конфликтует с её отменой и правкой и после первой заявки. Документы без заявок поля не имеют.
   */
  entryAdmissions?: number;
  /**
   * Момент публикации протокола (race-results-05): фаза `final`, отмена гонки недоступна (D-19). Пишет только
   * `RacesRepository.markProtocolPublished` (порт `RaceRegistry`); документы до `0016_protocol` — `?? null`.
   */
  protocolPublishedAt: Date | null;
  /**
   * Зафиксированная отсечка приёма споров (race-results-06, D-44, RC-7): пишет `RacesService.update`, когда плановая
   * дата протокола переносится после наступления отсечки (`protocolPlannedAt − 24 ч`), — перенос позже не открывает
   * приём снова. `null` — отсечка считается от текущей плановой даты. Документы до `0018_disputes` — `?? null`.
   */
  disputeFilingClosedAt: Date | null;
  /**
   * Счётчик замка результатов гонки (race-results-05): `lockResults` увеличивает его первой операцией каждой
   * транзакции действий панели над результатами — две такие транзакции одной гонки, а также они и отмена/правка
   * гонки конфликтуют. Документы без действий поля не имеют.
   */
  resultsVersion?: number;
  version: number;
}

/** Коридор гонки: готовый маршрут, допуск ±`widthM` м, длина маршрута, м (снимок; дистанция гонки — из неё). */
export interface RaceCorridor {
  routeId: string;
  widthM: number;
  distanceM: number;
}

/**
 * Документ-замок расписания (`_id: 'schedule'`, R2): транзакция, меняющая даты сезона, публикующая гонку или
 * меняющая конец окна опубликованной, первой операцией пишет `version` — две такие транзакции конфликтуют.
 */
export interface RaceMetaDoc {
  _id: 'schedule';
  version: number;
}

export interface RacesCollections {
  seasons: Collection<SeasonDoc>;
  races: Collection<RaceDoc>;
  meta: Collection<RaceMetaDoc>;
}

export function racesCollections(db: Db): RacesCollections {
  return {
    seasons: db.collection<SeasonDoc>(RACES_COLLECTIONS.seasons),
    races: db.collection<RaceDoc>(RACES_COLLECTIONS.races),
    meta: db.collection<RaceMetaDoc>(RACES_COLLECTIONS.meta),
  };
}
