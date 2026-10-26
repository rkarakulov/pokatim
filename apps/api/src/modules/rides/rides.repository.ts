import { Inject, Injectable } from '@nestjs/common';
import { type CityCode, RIDE_MAX_PARTICIPANTS, type RideCancelReason } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db, Filter } from 'mongodb';

import { type RideDoc, type RidePublicDoc, ridesCollections } from './rides.collection';

/** Документ для зрителя: из участников — только он сам (`$elemMatch` своего id), чужие id не читаются. */
export type RideViewerDoc = RideDoc;

/**
 * Проекция зрителя: `$elemMatch` делает проекцию включающей — остальные поля перечислены явно; из участников —
 * только сам зритель.
 */
const VIEWER_FIELDS = {
  status: 1,
  organizerUserId: 1,
  organizerName: 1,
  title: 1,
  description: 1,
  startsAt: 1,
  cityCode: 1,
  place: 1,
  distanceKm: 1,
  paceMinKmh: 1,
  paceMaxKmh: 1,
  limit: 1,
  goingCount: 1,
  cancelReason: 1,
  cancelledAt: 1,
  rescheduledAt: 1,
  createdAt: 1,
  updatedAt: 1,
  version: 1,
} as const satisfies Record<Exclude<keyof RideDoc, '_id' | 'participants'>, 1>;
const viewerProjection = (userId: string) => ({
  ...VIEWER_FIELDS,
  participants: { $elemMatch: { userId } },
});

/** Публичная проекция: без организатора, участников, `version`. */
const PUBLIC_PROJECTION = { organizerUserId: 0, participants: 0, version: 0 } as const;

/** Поля, которые правка организатора может менять (значения — примитивы после zod). */
export type RidePatch = Partial<
  Pick<
    RideDoc,
    | 'title'
    | 'organizerName'
    | 'description'
    | 'startsAt'
    | 'cityCode'
    | 'place'
    | 'distanceKm'
    | 'paceMinKmh'
    | 'paceMaxKmh'
    | 'limit'
  >
>;

/**
 * Единственный писатель `rides`. Все инварианты участия и правок — одной атомарной операцией над **одним**
 * документом с условием в фильтре (`findOneAndUpdate`, без транзакций и замков, `pokatim-db.md`): лимит мест,
 * статус, время, членство, владение, `version`. `null` — условие не выполнено; причину классифицирует сервис по
 * свежему чтению. Значения фильтров — примитивы после zod.
 */
@Injectable()
export class RidesRepository {
  private readonly rides: Collection<RideDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.rides = ridesCollections(db).rides;
  }

  async insert(doc: RideDoc): Promise<void> {
    await this.rides.insertOne(doc);
  }

  /** Состояние для зрителя (классификация отказов, `me`): участники — только сам зритель. */
  async findForViewer(id: string, userId: string): Promise<RideViewerDoc | undefined> {
    return (
      (await this.rides.findOne({ _id: id }, { projection: viewerProjection(userId) })) ?? undefined
    );
  }

  /** Публичная карточка: опубликованный, отменённый и прошедший райд; без служебных полей. */
  async findPublic(id: string): Promise<RidePublicDoc | undefined> {
    return (
      (await this.rides.findOne<RidePublicDoc>({ _id: id }, { projection: PUBLIC_PROJECTION })) ??
      undefined
    );
  }

  /**
   * «Я иду»: будущий опубликованный райд, ещё не участник, есть место (`goingCount < limit ?? 100`) — всё в фильтре
   * одной операции: параллельные нажатия на последнее место не переберут лимит.
   */
  join(id: string, userId: string, now: Date): Promise<RideDoc | null> {
    return this.rides.findOneAndUpdate(
      {
        _id: id,
        status: 'published',
        startsAt: { $gt: now },
        'participants.userId': { $ne: userId },
        $expr: { $lt: ['$goingCount', { $ifNull: ['$limit', RIDE_MAX_PARTICIPANTS] }] },
      },
      {
        $push: { participants: { userId, joinedAt: now } },
        $inc: { goingCount: 1 },
        $set: { updatedAt: now },
      },
      { returnDocument: 'after' },
    );
  }

  /** «Не иду»: участник (не организатор) будущего опубликованного райда. */
  leave(id: string, userId: string, now: Date): Promise<RideDoc | null> {
    return this.rides.findOneAndUpdate(
      {
        _id: id,
        status: 'published',
        startsAt: { $gt: now },
        organizerUserId: { $ne: userId },
        'participants.userId': userId,
      },
      {
        $pull: { participants: { userId } },
        $inc: { goingCount: -1 },
        $set: { updatedAt: now },
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * Правка организатором по ожидаемой `version` до старта; новый лимит — не ниже идущих в том же фильтре (гонка
   * «правка лимита ↔ запись» закрыта: обе операции — над одним документом с условием). Pipeline-обновление: значения —
   * только `$literal`; `reschedule` (меняются время, город или место) ставит `rescheduledAt`, только если в момент
   * записи идут другие участники (`goingCount > 1` документа, а не прочитанный заранее).
   */
  update(
    id: string,
    userId: string,
    version: number,
    now: Date,
    patch: RidePatch,
    reschedule: boolean,
  ): Promise<RideDoc | null> {
    const filter: Filter<RideDoc> = {
      _id: id,
      organizerUserId: userId,
      version,
      status: 'published',
      startsAt: { $gt: now },
    };
    if (patch.limit !== undefined && patch.limit !== null) {
      filter.goingCount = { $lte: patch.limit };
    }
    const set: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(patch)) set[field] = { $literal: value };
    set.updatedAt = { $literal: now };
    set.version = { $add: ['$version', 1] };
    if (reschedule) {
      set.rescheduledAt = {
        $cond: [{ $gt: ['$goingCount', 1] }, { $literal: now }, '$rescheduledAt'],
      };
    }
    return this.rides.findOneAndUpdate(filter, [{ $set: set }], { returnDocument: 'after' });
  }

  /** Отмена организатором до старта, причина — из справочника. */
  cancel(id: string, userId: string, reason: RideCancelReason, now: Date): Promise<RideDoc | null> {
    return this.rides.findOneAndUpdate(
      { _id: id, organizerUserId: userId, status: 'published', startsAt: { $gt: now } },
      {
        $set: { status: 'cancelled', cancelReason: reason, cancelledAt: now, updatedAt: now },
        $inc: { version: 1 },
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * Видимые зрителю будущие райды: опубликованные и отменённые, где он участник или организатор (организатор —
   * всегда участник). Внутри фильтра города — ИЛИ.
   */
  private visible(userId: string, now: Date, cities?: readonly CityCode[]): Filter<RideDoc>[] {
    const and: Filter<RideDoc>[] = [
      { startsAt: { $gt: now } },
      { $or: [{ status: 'published' }, { status: 'cancelled', 'participants.userId': userId }] },
    ];
    if (cities?.length) and.push({ cityCode: { $in: [...cities] } });
    return and;
  }

  /** Лента по `(startsAt, _id)`, `limit + 1` — признак продолжения; участники — только сам зритель. */
  listFeed(
    userId: string,
    now: Date,
    cities: readonly CityCode[] | undefined,
    after: { startsAt: Date; id: string } | null,
    limit: number,
  ): Promise<RideViewerDoc[]> {
    const and = this.visible(userId, now, cities);
    if (after) {
      and.push({
        $or: [
          { startsAt: { $gt: after.startsAt } },
          { startsAt: after.startsAt, _id: { $gt: after.id } },
        ],
      });
    }
    return this.rides
      .find({ $and: and }, { projection: viewerProjection(userId) })
      .sort({ startsAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
  }

  /** Коды городов, где у зрителя есть видимые будущие райды. */
  async cities(userId: string, now: Date): Promise<string[]> {
    const codes = await this.rides.distinct('cityCode', { $and: this.visible(userId, now) });
    return codes.map(String);
  }

  /**
   * Квоты — `countDocuments` до операции. Условие по другим документам — **принятая гонка** (`pokatim-db.md`):
   * параллельные запросы могут превысить квоту на единицу, это безвредно; основной барьер — лимит частоты Redis.
   */
  countUpcomingOrganized(userId: string, now: Date): Promise<number> {
    return this.rides.countDocuments({
      organizerUserId: userId,
      status: 'published',
      startsAt: { $gt: now },
    });
  }

  /** Будущие отметки «Я иду» в чужих райдах (принятая гонка, как `countUpcomingOrganized`). */
  countUpcomingJoined(userId: string, now: Date): Promise<number> {
    return this.rides.countDocuments({
      'participants.userId': userId,
      organizerUserId: { $ne: userId },
      status: 'published',
      startsAt: { $gt: now },
    });
  }
}
