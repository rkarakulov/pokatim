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
 * опубликованной (черновик без сезона, R9). Коридора нет до слайса маршрутов (Q4).
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
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  version: number;
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
