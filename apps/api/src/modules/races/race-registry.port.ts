import type { GroupScheme, RacePhase, RaceStatus } from '@pokatim/contracts';

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
  /**
   * схема групп зачёта (race-results-07); `null` — заявок ещё не было (первая получит `gender_age`). Документ без
   * схемы, но с `lockedAt` (RC-7) — `overall`.
   */
  groupScheme: GroupScheme | null;
  /** момент публикации протокола (race-results-05); `null` — не опубликован */
  protocolPublishedAt: Date | null;
  /** зафиксированная отсечка приёма споров (race-results-06, RC-7); `null` — от плановой даты протокола */
  disputeFilingClosedAt: Date | null;
}

export interface RaceRegistry {
  /**
   * Первая операция транзакции заявки: запись `lockedAt ??= now` и `groupScheme ??= gender_age` (race-results-07) в
   * документ опубликованной гонки (конфликт записи с правкой и отменой гонки панелью). Не опубликована или не найдена
   * — `null`.
   */
  admitEntry(tx: DbSession, raceId: string, now: Date): Promise<RaceForResults | null>;
  /**
   * Замок результатов гонки (race-results-05): запись `resultsVersion` в документ опубликованной или отменённой
   * гонки — **первая** операция транзакций действий панели над результатами. Нет или черновик — `null`
   * (отменённую вызывающий отклоняет сам).
   */
  lockResults(tx: DbSession, raceId: string): Promise<RaceForResults | null>;
  /** Протокол опубликован (`protocolPublishedAt = at`): только опубликованная без протокола; иначе `false`. */
  markProtocolPublished(tx: DbSession, raceId: string, at: Date): Promise<boolean>;
  /** Только `published` и `cancelled`. */
  get(raceId: string, tx?: DbSession): Promise<RaceForResults | null>;
  /** Пачкой (event-tickets: «Мои билеты», сверка): только `published` и `cancelled`, остальных в карте нет. */
  getMany(raceIds: readonly string[]): Promise<Map<string, RaceForResults>>;
  /** Гонка, видимая сотруднику (видимость — как в панели гонок); иначе `null`. */
  findForPanel(principal: PanelPrincipal, raceId: string): Promise<RaceForResults | null>;
  phase(race: RaceForResults, now: Date): RacePhase;
}
