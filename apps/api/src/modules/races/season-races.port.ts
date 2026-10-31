import type { BikeClass, GroupScheme } from '@pokatim/contracts';

import type { PanelPrincipal } from '../panel';

/**
 * Порт `races` для модуля `standings` (race-results-08, через `modules/races/index.ts`): сезоны и гонки сезона с
 * опубликованным протоколом, завершённые сезоны и «ждут протокола» (achievements-seasonal), видимость гонок сотруднику. `standings` коллекций `races` не читает.
 */
export const SEASON_RACES = Symbol('SEASON_RACES');

export interface SeasonRaceForStandings {
  id: string;
  seasonId: string;
  bikeClass: BikeClass;
  /**
   * Схема групп: гонка с протоколом без заявок (`groupScheme: null`) — `gender_age`, её получила бы первая заявка
   * (RC-2); документ без схемы, но с `lockedAt` (RC-7 07) — `overall`.
   */
  groupScheme: GroupScheme;
  title: string;
  windowEndsAt: Date;
}

/** Завершённый сезон (последний день по Минску прошёл: `endsBefore ≤ now`). */
export interface FinishedSeason {
  id: string;
  name: string;
  endsOn: string;
  endsBefore: Date;
}

export interface SeasonRaces {
  /**
   * Опубликованные гонки с протоколом (`protocolPublishedAt` — дата) сезонов `seasonIds`, без них — всех сезонов
   * (индекс `races_protocol_idx`); порядок `(seasonId, windowEndsAt, _id)`.
   */
  protocolRaces(seasonIds?: readonly string[]): Promise<SeasonRaceForStandings[]>;
  /** Завершённые к `now` сезоны (`endsBefore ≤ now`; их десятки). */
  finishedSeasons(now: Date): Promise<FinishedSeason[]>;
  /**
   * Сезоны из `seasonIds`, где есть опубликованная гонка с коридором без протокола (итог сезона ещё не полон, RC-S2);
   * отменённые и анонсы (`corridor: null`) не считаются.
   */
  awaitingProtocol(seasonIds: readonly string[]): Promise<Set<string>>;
  /** Сезон существует (видимость — как `GET /v1/seasons/:id`, RC-7). */
  seasonExists(seasonId: string): Promise<boolean>;
  /** Сотрудник видит все гонки (не `ownScope` организатора, RC-8). */
  seesAllRaces(principal: Pick<PanelPrincipal, 'permissions'>): boolean;
}
