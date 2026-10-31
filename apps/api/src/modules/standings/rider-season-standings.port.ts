import type { BikeClass, ResultGroupKey } from '@pokatim/contracts';

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
   * Названия **завершённых** сезонов из `seasonIds` (текст уведомления о сезонном достижении, achievements-push): лёгкое
   * чтение через `SEASON_RACES.finishedSeasons`, без снимка и источника. Незавершённые и неизвестные — нет в карте.
   */
  seasonTitles(seasonIds: readonly string[], now: Date): Promise<Map<string, string>>;
}
