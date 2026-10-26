import type { RacePhase, RaceStatus } from '@pokatim/contracts';

import type { DbSession } from '../../db';
import type { PanelPrincipal } from '../panel';
import type { RaceCorridor } from './races.collection';

/**
 * Порт `races` для модуля `results` (через `modules/races/index.ts`, race-results-03): гонка для участия и проверки
 * попыток, фиксация V-12 первой заявкой, видимость гонки в панели. `results` коллекции `races` не читает.
 */
export const RACE_REGISTRY = Symbol('RACE_REGISTRY');

export interface RaceForResults {
  id: string;
  ownerUserId: string;
  status: RaceStatus;
  title: string;
  windowStartsAt: Date;
  windowEndsAt: Date;
  /** `windowEndsAt + 1 мин` — исключающая граница окна (R12), считает `races` */
  closesAt: Date;
  protocolPlannedAt: Date;
  corridor: RaceCorridor | null;
  lockedAt: Date | null;
}

export interface RaceRegistry {
  /**
   * Первая операция транзакции заявки: запись `lockedAt ??= now` в документ опубликованной гонки (конфликт записи с
   * правкой и отменой гонки панелью). Не опубликована или не найдена — `null`.
   */
  admitEntry(tx: DbSession, raceId: string, now: Date): Promise<RaceForResults | null>;
  /** Только `published` и `cancelled`. */
  get(raceId: string, tx?: DbSession): Promise<RaceForResults | null>;
  /** Гонка, видимая сотруднику (видимость — как в панели гонок); иначе `null`. */
  findForPanel(principal: PanelPrincipal, raceId: string): Promise<RaceForResults | null>;
  phase(race: RaceForResults, now: Date): RacePhase;
}
