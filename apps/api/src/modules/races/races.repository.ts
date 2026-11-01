import { Inject, Injectable } from '@nestjs/common';
import type { BikeClass, RaceStatus } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Db, Filter, UpdateFilter } from 'mongodb';

import {
  CHANGED_SORT,
  type ChangedCursor,
  changedAfter,
  type ChangedRow,
} from '../../changed-since';
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
function overviewFilter(
  phase: 'open' | 'closed',
  { now, closedBefore, ownerUserId }: { now: Date; closedBefore: Date; ownerUserId?: string },
): Filter<RaceDoc> {
  const filter: Filter<RaceDoc> = {
    status: 'published',
    protocolPublishedAt: null,
    ...(phase === 'open'
      ? { windowStartsAt: { $lte: now }, windowEndsAt: { $gt: closedBefore } }
      : { windowEndsAt: { $lte: closedBefore } }),
  };
  if (ownerUserId !== undefined) filter.ownerUserId = ownerUserId;
  return filter;
}

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

  /** Опубликованные гонки сезона (OG-картинка сезона); префикс индекса `races_season_idx`. */
  countPublishedInSeason(seasonId: string): Promise<number> {
    return this.c.races.countDocuments({ seasonId, status: 'published' });
  }

  /** Сезоны с `endsOn ≥ sinceLocalDate` (их десятки — без индекса), только `_id`, по `_id`. */
  liveSeasons(sinceLocalDate: string): Promise<{ _id: string }[]> {
    return this.c.seasons
      .find({ endsOn: { $gte: sinceLocalDate } }, { projection: { _id: 1 } })
      .sort({ _id: 1 })
      .toArray();
  }

  /** Сезоны, завершённые к `now` (`endsBefore ≤ now`; их десятки — без индекса), по `_id`. */
  seasonsEndedBy(now: Date): Promise<Pick<SeasonDoc, '_id' | 'name' | 'endsOn' | 'endsBefore'>[]> {
    return this.c.seasons
      .find(
        { endsBefore: { $lte: now } },
        { projection: { _id: 1, name: 1, endsOn: 1, endsBefore: 1 } },
      )
      .sort({ _id: 1 })
      .toArray();
  }

  /**
   * Сезоны из `seasonIds` с опубликованной гонкой с коридором без протокола (префикс индекса `races_season_idx`);
   * отменённые и анонсы (`corridor: null`, документ без поля) — не считаются.
   */
  seasonsAwaitingProtocol(seasonIds: readonly string[]): Promise<string[]> {
    return this.c.races.distinct('seasonId', {
      seasonId: { $in: [...seasonIds] },
      status: 'published',
      protocolPublishedAt: null,
      corridor: { $ne: null },
    }) as Promise<string[]>;
  }

  /**
   * Последняя отмена гонки с коридором по сезонам из `seasonIds` (префикс индекса `races_season_idx`; гонок сезона —
   * десятки); анонсы (`corridor: null`) итог сезона не держали — не считаются.
   */
  async lastCancelledAt(seasonIds: readonly string[]): Promise<Map<string, Date>> {
    const rows = await this.c.races
      .aggregate<{ _id: string; at: Date }>([
        {
          $match: {
            seasonId: { $in: [...seasonIds] },
            status: 'cancelled',
            cancelledAt: { $ne: null },
            corridor: { $ne: null },
          },
        },
        { $group: { _id: '$seasonId', at: { $max: '$cancelledAt' } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [row._id, row.at]));
  }

  // --- гонки ---

  async findRace(id: string, session?: DbSession): Promise<RaceDoc | undefined> {
    return (await this.c.races.findOne({ _id: id }, { session })) ?? undefined;
  }

  /**
   * Опубликованные гонки с протоколом, опубликованным не раньше `since` (Главная «Свои», social-p7):
   * `protocolPublishedAt ↓, _id ↓`, ≤ `limit`; индекс `races_protocol_published_idx`.
   */
  protocolsPublishedSince(since: Date, limit: number): Promise<RaceDoc[]> {
    return this.c.races
      .find({ status: 'published', protocolPublishedAt: { $gte: since } })
      .sort({ protocolPublishedAt: -1, _id: -1 })
      .hint('races_protocol_published_idx')
      .limit(limit)
      .toArray();
  }

  /** Гонки по id (`_id` — индекс); незнакомые id — без документа. */
  findRaces(ids: readonly string[]): Promise<RaceDoc[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.c.races.find({ _id: { $in: [...new Set(ids)] } }).toArray();
  }

  /**
   * Опубликованные гонки без протокола в фазе «Обзора» панели (admin-overview): `open` — окно идёт
   * (`windowStartsAt ≤ now < closesAt`), `closed` — окно закрыто, протокол ждёт публикации. `closedBefore` —
   * `now − windowEndGraceMs` (граница `racePhase`); `ownerUserId` — только свои (организатор). `open` — раньше
   * закрывающиеся первыми, `closed` — недавно закрывшиеся первыми (давно забытые не вытесняют свежие из лимита).
   * `protocolPublishedAt: null` ловит и документы до `0016_protocol` без поля.
   */
  async overviewRaces(
    phase: 'open' | 'closed',
    bounds: { now: Date; closedBefore: Date; ownerUserId?: string },
    limit: number,
  ): Promise<{ total: number; docs: RaceDoc[] }> {
    const filter = overviewFilter(phase, bounds);
    const [total, docs] = await Promise.all([
      this.c.races.countDocuments(filter),
      this.c.races
        .find(filter)
        .sort(phase === 'open' ? { windowEndsAt: 1, _id: 1 } : { windowEndsAt: -1, _id: -1 })
        .limit(limit)
        .toArray(),
    ]);
    return { total, docs };
  }

  async insertRace(session: DbSession, doc: RaceDoc): Promise<void> {
    await this.c.races.insertOne(doc, { session });
  }

  /**
   * Атомарное изменение гонки (R3): совпадение по `_id`, ожидаемой `version` и допустимому статусу; `null` — версия
   * устарела или статус уже другой. `guard.protocolPublishedAt: null` — протокол не опубликован (отмена, D-19:
   * второй рубеж после проверки в сервисе; гонку «отмена ↔ публикация» закрывает конфликт записи в документ гонки).
   */
  async updateRace(
    session: DbSession,
    id: string,
    version: number,
    statusIn: readonly RaceStatus[],
    set: UpdateFilter<RaceDoc>['$set'],
    guard: { protocolPublishedAt?: null } = {},
  ): Promise<RaceDoc | null> {
    return this.c.races.findOneAndUpdate(
      { _id: id, version, status: { $in: [...statusIn] }, ...guard },
      { $set: set, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    );
  }

  /**
   * Заявка участника (race-results-03, V-12): **запись** `lockedAt ??= now` и `entryAdmissions + 1` в документ
   * опубликованной гонки — первая операция транзакции заявки. Каждая заявка действительно меняет документ (счётчик):
   * конфликт записи с правкой (`updateRace`) и отменой гонки — проигравшая транзакция повторяется и видит `lockedAt`
   * или новый коридор/статус. `version` не меняется:
   * открытая форма панели не получает лишний `409`, поля блокирует политика. `null` — не опубликована.
   */
  admitEntry(session: DbSession, id: string, now: Date): Promise<RaceDoc | null> {
    return this.c.races.findOneAndUpdate(
      { _id: id, status: 'published' },
      [
        {
          $set: {
            lockedAt: { $ifNull: ['$lockedAt', { $literal: now }] },
            // race-results-07: схема групп — первой заявкой; выражения стадии видят документ до записи: гонка,
            // уже получившая `lockedAt` без схемы (заявка старого API в окне деплоя, RC-7), — `overall`
            groupScheme: {
              $ifNull: [
                '$groupScheme',
                {
                  $cond: [
                    { $eq: [{ $ifNull: ['$lockedAt', null] }, null] },
                    { $literal: 'gender_age' },
                    { $literal: 'overall' },
                  ],
                },
              ],
            },
            // настоящая запись каждой заявкой: после первой `lockedAt` не меняется, и без счётчика вторая заявка не
            // конфликтовала бы с отменой гонки
            entryAdmissions: { $add: [{ $ifNull: ['$entryAdmissions', 0] }, 1] },
          },
        },
      ],
      { session, returnDocument: 'after' },
    );
  }

  /**
   * Замок результатов гонки (race-results-05): `resultsVersion + 1` в документе опубликованной или отменённой гонки —
   * **первая** операция транзакций действий панели над результатами (исключение, возврат, публикация, перепроверка,
   * пересчёты). Две такие транзакции одной гонки конфликтуют (повтор `MongoTransactions.run`), как и с отменой и
   * правкой гонки (запись в тот же документ). `version` не меняется: открытая форма гонки не получает лишний `409`.
   * `null` — гонки нет или черновик.
   */
  lockResults(session: DbSession, id: string): Promise<RaceDoc | null> {
    return this.c.races.findOneAndUpdate(
      { _id: id, status: { $in: ['published', 'cancelled'] } },
      { $inc: { resultsVersion: 1 } },
      { session, returnDocument: 'after' },
    );
  }

  /** Протокол опубликован (D-22): только опубликованная гонка без протокола; `false` — не совпало. */
  async markProtocolPublished(session: DbSession, id: string, at: Date): Promise<boolean> {
    const updated = await this.c.races.updateOne(
      { _id: id, status: 'published', protocolPublishedAt: null },
      { $set: { protocolPublishedAt: at } },
      { session },
    );
    return updated.matchedCount === 1;
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

  /** Только опубликованная гонка (OG-картинка, og-images: отменённая — без своей картинки). */
  async findPublished(id: string): Promise<RaceDoc | undefined> {
    return (await this.c.races.findOne({ _id: id, status: 'published' })) ?? undefined;
  }

  /** Опубликованные гонки, изменившиеся после курсора (`og.sync`), по `(updatedAt, _id)` — индекс `0037_og_sync_indexes`. */
  async changedForOg(after: ChangedCursor | null, limit: number): Promise<ChangedRow[]> {
    const docs = await this.c.races
      .find(
        { status: 'published', ...changedAfter(after) },
        { projection: { _id: 1, updatedAt: 1 } },
      )
      .sort(CHANGED_SORT)
      .limit(limit)
      .toArray();
    return docs.map((doc) => ({ id: doc._id, updatedAt: doc.updatedAt }));
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

  /**
   * Публичные гонки маршрута каталога (routes-01): опубликованные и отменённые с коридором по `routeId`, новые окна
   * сверху `(windowStartsAt desc, _id desc)` — индекс `races_route_idx`.
   */
  listPublicByRoute(
    routeId: string,
    after: CursorPosition<Date> | null,
    limit: number,
  ): Promise<RaceDoc[]> {
    const query: Filter<RaceDoc> = {
      'corridor.routeId': routeId,
      status: { $in: ['published', 'cancelled'] },
    };
    if (after) {
      query.$or = [
        { windowStartsAt: { $lt: after.k } },
        { windowStartsAt: after.k, _id: { $lt: after.id } },
      ];
    }
    return this.c.races.find(query).sort({ windowStartsAt: -1, _id: -1 }).limit(limit).toArray();
  }

  /**
   * Гонки с опубликованным протоколом для рейтинга сезона (race-results-08): сезона `seasonId` или всех сезонов, по
   * `(seasonId, windowEndsAt, _id)`. Условие `protocolPublishedAt: { $type: 'date' }` — ровно частичный фильтр
   * `races_protocol_idx` (RC-4); статус — защита (протокол есть только у опубликованной, D-19).
   */
  listProtocolRaces(
    seasonIds?: readonly string[],
  ): Promise<
    Pick<
      RaceDoc,
      '_id' | 'seasonId' | 'bikeClass' | 'groupScheme' | 'lockedAt' | 'title' | 'windowEndsAt'
    >[]
  > {
    const query: Filter<RaceDoc> = {
      protocolPublishedAt: { $type: 'date' },
      status: 'published',
      seasonId: seasonIds ? { $in: [...seasonIds] } : { $type: 'string' },
    };
    return this.c.races
      .find(query, {
        projection: {
          _id: 1,
          seasonId: 1,
          bikeClass: 1,
          groupScheme: 1,
          lockedAt: 1,
          title: 1,
          windowEndsAt: 1,
        },
      })
      .sort({ seasonId: 1, windowEndsAt: 1, _id: 1 })
      .toArray();
  }

  /** Сезон гонки с протоколом (то же условие, что `listProtocolRaces`); иначе `undefined`. */
  async protocolRaceSeason(raceId: string): Promise<string | undefined> {
    const doc = await this.c.races.findOne(
      {
        _id: raceId,
        protocolPublishedAt: { $type: 'date' },
        status: 'published',
        seasonId: { $type: 'string' },
      },
      { projection: { seasonId: 1 } },
    );
    return doc?.seasonId ?? undefined;
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
