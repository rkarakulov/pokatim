import type { BikeClass, GroupScheme, ResultGroupKey, StandingOutcome } from '@pokatim/contracts';
import type { Collection, Db } from 'mongodb';

/**
 * Коллекции модуля `standings` (race-results-08) — снимок рейтинга сезона, производная проекция протоколов. Создаёт
 * миграция `0030_standings`; единственный писатель — `StandingsRepository`. Не append-only: снимок сезона заменяется
 * целиком в одной транзакции под условием версии источника (RC-5). Данные пользователя — только псевдонимный `userId`
 * и числа (как строки протокола, A9); имена читаются при каждом запросе (RC-6).
 */
export const STANDINGS_COLLECTIONS = {
  seasons: 'season_standings',
  rows: 'season_standing_rows',
} as const;

/** Гонка снимка (название неизменно в фазе `final`, RC-1). */
export interface StandingsRaceDoc {
  raceId: string;
  title: string;
  windowEndsAt: Date;
  bikeClass: BikeClass;
  groupScheme: GroupScheme;
  revision: number;
}

/** Таблица снимка «класс × группа». */
export interface StandingsTableDoc {
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
  /** гонки таблицы по `(windowEndsAt, raceId)` — порядок ячеек строк */
  raceIds: string[];
  racesTotal: number;
  racesCounted: number;
  riders: number;
}

/** Заголовок снимка сезона: `_id` = seasonId; пишет только `StandingsRepository.claimSeason` (RC-5). */
export interface SeasonStandingsDoc {
  _id: string;
  formulaVersion: number;
  /** Σ текущих ревизий гонок сезона с протоколом — монотонна (RC-1, RC-5) */
  sourceVersion: number;
  /** sha256 hex `sourceFingerprint` */
  fingerprint: string;
  computedAt: Date;
  /** по `(windowEndsAt, raceId)` */
  races: StandingsRaceDoc[];
  /** порядок `BIKE_CLASSES`, затем `RESULT_GROUP_KEYS` */
  tables: StandingsTableDoc[];
}

export interface StandingCellDoc {
  raceId: string;
  place: number | null;
  tied: boolean;
  outcome: StandingOutcome;
  points: number;
  counted: boolean;
}

/** Строка таблицы снимка; набор строк сезона заменяется целиком в транзакции с заголовком (не append-only). */
export interface SeasonStandingRowDoc {
  /** uuidv7 */
  _id: string;
  seasonId: string;
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
  /** позиция в таблице, 0… */
  order: number;
  userId: string;
  place: number;
  tied: boolean;
  points: number;
  cells: StandingCellDoc[];
}

export interface StandingsCollections {
  seasons: Collection<SeasonStandingsDoc>;
  rows: Collection<SeasonStandingRowDoc>;
}

export function standingsCollections(db: Db): StandingsCollections {
  return {
    seasons: db.collection<SeasonStandingsDoc>(STANDINGS_COLLECTIONS.seasons),
    rows: db.collection<SeasonStandingRowDoc>(STANDINGS_COLLECTIONS.rows),
  };
}
