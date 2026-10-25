import { Inject, Injectable } from '@nestjs/common';
import type { BikeClass, RaceStatus } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter, UpdateFilter } from 'mongodb';

import type { DbSession } from '../../db';
import {
  type RaceDoc,
  type RacesCollections,
  racesCollections,
  type SeasonDoc,
} from './races.collection';

/** Позиция курсора списка: ключ сортировки и `_id` последнего элемента страницы. */
export interface CursorPosition<K> {
  k: K;
  id: string;
}

/** Фильтр списка гонок панели — только примитивы после zod; `ownerUserId` ставит сервер. */
export interface PanelRaceFilter {
  status?: RaceStatus;
  seasonId?: string;
  bikeClass?: BikeClass;
  ownerUserId?: string;
}

/** Диапазон моментов `[startsAt, endsBefore)`. */
export interface InstantRange {
  startsAt: Date;
  endsBefore: Date;
}

/**
 * Единственный писатель `seasons`, `races`, `race_meta` (ADR-0010). Правила (`pokatim-db.md`):
 * - «сезоны не пересекаются» и «опубликованная гонка — внутри своего сезона» — условия по **другим** документам:
 *   транзакция, создающая/меняющая даты сезона, публикующая гонку или меняющая конец окна опубликованной, первой
 *   операцией вызывает `lockSchedule` (`$inc version` документа `race_meta.schedule`, R2) — иначе write skew;
 * - изменение записи — `findOneAndUpdate` с ожидаемой `version` и статусом в фильтре (R3): нет совпадения — `null`;
 * - значения фильтров — только примитивы после zod (id, enum-ы, даты).
 */
@Injectable()
export class RacesRepository {
  private readonly c: RacesCollections;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.c = racesCollections(db);
  }

  /**
   * Замок расписания (R2) — первая операция транзакции. `upsert`: документ создаёт миграция, но и без него замок
   * работает (гонку вставки ловит `_id`).
   */
  async lockSchedule(session: DbSession): Promise<void> {
    await this.c.meta.updateOne(
      { _id: 'schedule' },
      { $inc: { version: 1 } },
      { session, upsert: true },
    );
  }

  // --- сезоны ---

  /** Все сезоны (их десятки), новые сверху. */
  listSeasons(session?: DbSession): Promise<SeasonDoc[]> {
    return this.c.seasons.find({}, { session }).sort({ startsAt: -1, _id: -1 }).toArray();
  }

  async findSeason(id: string, session?: DbSession): Promise<SeasonDoc | undefined> {
    return (await this.c.seasons.findOne({ _id: id }, { session })) ?? undefined;
  }

  /** Сезон, в который попадает момент (`startsAt ≤ at < endsBefore`). */
  async seasonCovering(at: Date, session?: DbSession): Promise<SeasonDoc | undefined> {
    const doc = await this.c.seasons.findOne(
      { startsAt: { $lte: at }, endsBefore: { $gt: at } },
      { session },
    );
    return doc ?? undefined;
  }

  /** Сезон, пересекающий диапазон (кроме `exceptId`) — под `lockSchedule`. */
  async overlapping(
    range: InstantRange,
    exceptId: string | null,
    session: DbSession,
  ): Promise<SeasonDoc | undefined> {
    const filter: Filter<SeasonDoc> = {
      startsAt: { $lt: range.endsBefore },
      endsBefore: { $gt: range.startsAt },
    };
    if (exceptId) filter._id = { $ne: exceptId };
    return (await this.c.seasons.findOne(filter, { session, sort: { startsAt: 1 } })) ?? undefined;
  }

  async insertSeason(session: DbSession, doc: SeasonDoc): Promise<void> {
    await this.c.seasons.insertOne(doc, { session });
  }

  /** Изменение сезона с ожидаемой версией; `null` — версия устарела или сезона нет. */
  async updateSeason(
    session: DbSession,
    id: string,
    version: number,
    set: Partial<Omit<SeasonDoc, '_id' | 'version'>>,
  ): Promise<SeasonDoc | null> {
    return this.c.seasons.findOneAndUpdate(
      { _id: id, version },
      { $set: set, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    );
  }

  /** Гонки сезона, конец окна которых выпадает из диапазона (сжатие сезона) — под `lockSchedule`. */
  racesOutside(seasonId: string, range: InstantRange, session: DbSession): Promise<number> {
    return this.c.races.countDocuments(
      {
        seasonId,
        $or: [
          { windowEndsAt: { $lt: range.startsAt } },
          { windowEndsAt: { $gte: range.endsBefore } },
        ],
      },
      { session },
    );
  }

  /** Число гонок по сезонам (опубликованные и отменённые — у черновика нет `seasonId`). */
  async raceCounts(): Promise<Map<string, number>> {
    const rows = await this.c.races
      .aggregate<{ _id: string; count: number }>([
        { $match: { seasonId: { $type: 'string' } } },
        { $group: { _id: '$seasonId', count: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [row._id, row.count]));
  }

  /** Гонки одного сезона (ответ после изменения сезона). */
  countSeasonRaces(seasonId: string): Promise<number> {
    return this.c.races.countDocuments({ seasonId });
  }

  // --- гонки ---

  async findRace(id: string, session?: DbSession): Promise<RaceDoc | undefined> {
    return (await this.c.races.findOne({ _id: id }, { session })) ?? undefined;
  }

  async insertRace(session: DbSession, doc: RaceDoc): Promise<void> {
    await this.c.races.insertOne(doc, { session });
  }

  /**
   * Атомарное изменение гонки (R3): совпадение по `_id`, ожидаемой `version` и допустимому статусу; `null` — версия
   * устарела или статус уже другой.
   */
  async updateRace(
    session: DbSession,
    id: string,
    version: number,
    statusIn: readonly RaceStatus[],
    set: UpdateFilter<RaceDoc>['$set'],
  ): Promise<RaceDoc | null> {
    return this.c.races.findOneAndUpdate(
      { _id: id, version, status: { $in: [...statusIn] } },
      { $set: set, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    );
  }

  /** Удаление черновика с ожидаемой версией; `null` — не черновик или версия устарела. */
  deleteDraft(session: DbSession, id: string, version: number): Promise<RaceDoc | null> {
    return this.c.races.findOneAndDelete({ _id: id, version, status: 'draft' }, { session });
  }

  /**
   * Публичный список (только опубликованные и отменённые). `current` — опубликованные с незакрытым окном
   * (`windowEndsAt > closedBefore`), по началу окна; `past` — закрытые и отменённые, по концу окна (новые сверху).
   * Внутри фильтра — ИЛИ, между фильтрами — И; месяц — окно пересекает `[startsAt, endsBefore)`.
   */
  listPublic(
    filter: {
      scope: 'current' | 'past';
      /** Окно с `windowEndsAt ≤ closedBefore` закрыто (`now − 1 мин`, R12). */
      closedBefore: Date;
      bikeClasses?: readonly BikeClass[];
      months?: readonly InstantRange[];
    },
    after: CursorPosition<Date> | null,
    limit: number,
  ): Promise<RaceDoc[]> {
    const current = filter.scope === 'current';
    const and: Filter<RaceDoc>[] = current
      ? [{ status: 'published', windowEndsAt: { $gt: filter.closedBefore } }]
      : [
          { status: { $in: ['published', 'cancelled'] } },
          {
            $or: [{ status: 'cancelled' }, { windowEndsAt: { $lte: filter.closedBefore } }],
          },
        ];
    if (filter.bikeClasses?.length) and.push({ bikeClass: { $in: [...filter.bikeClasses] } });
    if (filter.months?.length) {
      and.push({
        $or: filter.months.map((month) => ({
          windowStartsAt: { $lt: month.endsBefore },
          windowEndsAt: { $gte: month.startsAt },
        })),
      });
    }
    const key = current ? 'windowStartsAt' : 'windowEndsAt';
    if (after) {
      and.push({
        $or: [
          { [key]: current ? { $gt: after.k } : { $lt: after.k } },
          { [key]: after.k, _id: current ? { $gt: after.id } : { $lt: after.id } },
        ],
      });
    }
    const direction = current ? 1 : -1;
    return this.c.races
      .find({ $and: and })
      .sort({ [key]: direction, _id: direction })
      .limit(limit)
      .toArray();
  }

  /** Опубликованная или отменённая гонка (публичная карточка); черновик — нет. */
  async findPublic(id: string): Promise<RaceDoc | undefined> {
    const doc = await this.c.races.findOne({
      _id: id,
      status: { $in: ['published', 'cancelled'] },
    });
    return doc ?? undefined;
  }

  /**
   * Публичные гонки сезона (опубликованные и отменённые) по концу окна, возрастание `(windowEndsAt, _id)` — индекс
   * `races_season_public_idx`. У черновика `seasonId: null`; условие по статусу — защита.
   */
  listSeasonRacesPublic(
    seasonId: string,
    after: CursorPosition<Date> | null,
    limit: number,
  ): Promise<RaceDoc[]> {
    const query: Filter<RaceDoc> = {
      seasonId,
      status: { $in: ['published', 'cancelled'] },
    };
    if (after) {
      query.$or = [
        { windowEndsAt: { $gt: after.k } },
        { windowEndsAt: after.k, _id: { $gt: after.id } },
      ];
    }
    return this.c.races.find(query).sort({ windowEndsAt: 1, _id: 1 }).limit(limit).toArray();
  }

  /** Страница панели: новые окна сверху (`windowStartsAt desc, _id desc`), `limit + 1` — признак продолжения. */
  listPanel(
    filter: PanelRaceFilter,
    after: CursorPosition<Date> | null,
    limit: number,
  ): Promise<RaceDoc[]> {
    const query: Filter<RaceDoc> = {};
    if (filter.status) query.status = filter.status;
    if (filter.seasonId) query.seasonId = filter.seasonId;
    if (filter.bikeClass) query.bikeClass = filter.bikeClass;
    if (filter.ownerUserId) query.ownerUserId = filter.ownerUserId;
    if (after) {
      query.$or = [
        { windowStartsAt: { $lt: after.k } },
        { windowStartsAt: after.k, _id: { $lt: after.id } },
      ];
    }
    return this.c.races.find(query).sort({ windowStartsAt: -1, _id: -1 }).limit(limit).toArray();
  }
}
