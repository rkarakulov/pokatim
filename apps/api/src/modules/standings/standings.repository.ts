import { Inject, Injectable } from '@nestjs/common';
import type { BikeClass, ResultGroupKey } from '@pokatim/contracts';
import { MONGO_CLIENT, MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter, MongoClient } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type SeasonStandingRowDoc,
  type SeasonStandingsDoc,
  type StandingsCollections,
  standingsCollections,
} from './standings.collection';

/**
 * Единственный писатель `season_standings` и `season_standing_rows` (race-results-08). Снимок сезона заменяется
 * целиком одной транзакцией: **первая** операция — `claimSeason` (условный upsert заголовка по версии источника,
 * RC-5), затем `replaceRows`. Более новый (или равный) заголовок — фильтр не совпал, upsert вставляет тот же `_id` —
 * ошибка `_id_`: вызывающий откатывает транзакцию (`stale`). Чтения страницы — в одной snapshot-сессии.
 */
@Injectable()
export class StandingsRepository {
  private readonly c: StandingsCollections;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
  ) {
    this.c = standingsCollections(db);
  }

  /**
   * Заголовок снимка (RC-5): пишет, только если сохранённый старше — меньше `formulaVersion` или та же формула и
   * меньше `sourceVersion`. Иначе — ошибка дубликата `_id_` (upsert при несовпавшем фильтре).
   */
  async claimSeason(tx: DbSession, header: SeasonStandingsDoc): Promise<void> {
    const { _id, ...set } = header;
    await this.c.seasons.updateOne(
      {
        _id,
        $or: [
          { formulaVersion: { $lt: header.formulaVersion } },
          { formulaVersion: header.formulaVersion, sourceVersion: { $lt: header.sourceVersion } },
        ],
      },
      { $set: set },
      { session: tx, upsert: true },
    );
  }

  /** Строки сезона целиком (после `claimSeason` в той же транзакции); пустой набор — без вставки. */
  async replaceRows(tx: DbSession, seasonId: string, rows: SeasonStandingRowDoc[]): Promise<void> {
    await this.c.rows.deleteMany({ seasonId }, { session: tx });
    if (rows.length > 0) await this.c.rows.insertMany(rows, { session: tx });
  }

  /** Отпечатки снимков сезонов (регламент): без `ids` — все. */
  async fingerprints(ids?: readonly string[]): Promise<Map<string, string>> {
    const filter: Filter<SeasonStandingsDoc> = ids ? { _id: { $in: [...ids] } } : {};
    const docs = await this.c.seasons
      .find(filter, { projection: { _id: 1, fingerprint: 1 } })
      .toArray();
    return new Map(docs.map((doc) => [doc._id, doc.fingerprint]));
  }

  async header(seasonId: string, session?: DbSession): Promise<SeasonStandingsDoc | undefined> {
    return (await this.c.seasons.findOne({ _id: seasonId }, { session })) ?? undefined;
  }

  /** Страница таблицы после позиции `afterOrder` по `order` (индекс `season_standing_rows_order_unique`). */
  rowsPage(
    seasonId: string,
    bikeClass: BikeClass,
    groupKey: ResultGroupKey,
    afterOrder: number | null,
    limit: number,
    session: DbSession,
  ): Promise<SeasonStandingRowDoc[]> {
    const filter: Filter<SeasonStandingRowDoc> = { seasonId, bikeClass, groupKey };
    if (afterOrder !== null) filter.order = { $gt: afterOrder };
    return this.c.rows.find(filter, { session }).sort({ order: 1 }).limit(limit).toArray();
  }

  /** Строки пользователя во всех таблицах сезона (индекс `season_standing_rows_user_idx`). */
  rowsOfUser(
    seasonId: string,
    userId: string,
    session: DbSession,
  ): Promise<SeasonStandingRowDoc[]> {
    return this.c.rows.find({ seasonId, userId }, { session }).toArray();
  }

  /** Чтения снимка в одной snapshot-сессии: заголовок и страница согласованы. */
  async withSnapshot<T>(fn: (session: DbSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession({ snapshot: true });
    try {
      return await fn(session);
    } finally {
      await session.endSession();
    }
  }
}
