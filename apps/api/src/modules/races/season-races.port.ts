import type { BikeClass, GroupScheme } from '@pokatim/contracts';

import type { PanelPrincipal } from '../panel';

/**
 * Порт `races` для модуля `standings` (race-results-08, через `modules/races/index.ts`): сезоны и гонки сезона с
 * опубликованным протоколом, видимость гонок сотруднику. `standings` коллекций `races` не читает.
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

export interface SeasonRaces {
  /**
   * Опубликованные гонки с протоколом (`protocolPublishedAt` — дата) сезона `seasonId`, без него — всех сезонов
   * (индекс `races_protocol_idx`); порядок `(seasonId, windowEndsAt, _id)`.
   */
  protocolRaces(seasonId?: string): Promise<SeasonRaceForStandings[]>;
  /** Сезон существует (видимость — как `GET /v1/seasons/:id`, RC-7). */
  seasonExists(seasonId: string): Promise<boolean>;
  /** Сотрудник видит все гонки (не `ownScope` организатора, RC-8). */
  seesAllRaces(principal: Pick<PanelPrincipal, 'permissions'>): boolean;
}
