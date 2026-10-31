import type { BikeClass, ResultGroupKey } from '@pokatim/contracts';

import type { ChangedCursor, RiderChanges } from '../../changed-since';

/**
 * Порт `standings` для модуля `achievements` (achievements-seasonal, через `modules/standings/index.ts`): итоги райдера
 * по завершённым сезонам из снимка рейтинга, без пересчёта. `achievements` коллекций `standings`/`races` не читает.
 */
export const RIDER_SEASON_STANDINGS = Symbol('RIDER_SEASON_STANDINGS');

/** Строка райдера в таблице «класс × группа» итогового снимка сезона. */
export interface RiderSeasonRow {
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
  /** место в таблице (ничья «=N» — N) */
  place: number;
  tied: boolean;
  /** ячеек с `outcome: 'placed'` (финиш с местом в протоколе; DQ и «нет строки» не считаются, RC-S3) */
  placedRaces: number;
}

export type RiderSeasonOutcome =
  | {
      seasonId: string;
      status: 'final';
      title: string;
      endsOn: string;
      endsBefore: Date;
      rows: RiderSeasonRow[];
    }
  | { seasonId: string; status: 'pending'; title: string };

export interface RiderSeasonStandings {
  /**
   * Итоги райдера по **завершённым** сезонам, где у него есть строки снимка, и по сезонам `alsoSeasonIds` (сохранённые
   * выдачи; там строк может уже не быть — тогда `final` с `rows: []`). `final`: последний день прошёл, гонок с
   * коридором без протокола нет (RC-S2), снимок есть и его отпечаток равен источнику. Иначе `pending`. Незавершённые и
   * неизвестные сезоны в ответ не попадают. Только чтение.
   */
  outcomesOf(
    userId: string,
    alsoSeasonIds: readonly string[],
    now: Date,
  ): Promise<RiderSeasonOutcome[]>;
  /**
   * Райдеры строк снимков сезонов, итог которых мог измениться в окне `(after, until]` (серверная сверка достижений,
   * achievements-push): сезон завершён к `until`, у него есть снимок, и момент события — `max(computedAt, endsBefore,
   * последняя отмена гонки с коридором ≤ until)` (пересчёт снимка, конец сезона после пересчёта, отмена гонки, ждавшей
   * протокола: `pending → final` без пересчёта; порт `SEASON_RACES.lastCancelledAt`) — попал в окно. Порядок — `(момент, seasonId)`, внутри
   * сезона — `userId` ↑ (индекс `season_standing_rows_user_idx`); предел — `limit` строк. Курсор: `id` —
   * `<seasonId>` (сезон пройден) или `<seasonId>|<userId>` (продолжение внутри сезона). Только чтение.
   */
  settledRidersAfter(after: ChangedCursor, until: Date, limit: number): Promise<RiderChanges>;
}
