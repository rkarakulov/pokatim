import { Inject, Injectable } from '@nestjs/common';
import { type CityCode, RIDE_MAX_PARTICIPANTS, type RideCancelReason } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db, Filter } from 'mongodb';

import type { DbSession } from '../../db';
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
  hiddenAt: 1,
  hiddenFromStatus: 1,
  openReportCount: 1,
  lastReportAt: 1,
} as const satisfies Record<Exclude<keyof RideDoc, '_id' | 'participants'>, 1>;
const viewerProjection = (userId: string) => ({
  ...VIEWER_FIELDS,
  participants: { $elemMatch: { userId } },
});

/** Публичная проекция: без организатора, участников, `version` и полей модерации. */
const PUBLIC_PROJECTION = {
  organizerUserId: 0,
  participants: 0,
  version: 0,
  hiddenAt: 0,
  hiddenFromStatus: 0,
  openReportCount: 0,
  lastReportAt: 0,
} as const;

/** Статусы, видимые не только организатору (скрытый — 05b — нет). */
const VISIBLE_STATUSES = ['published', 'cancelled'] as const;

/** Документ модерации: без участников. */
export type RideModerationDoc = Omit<RideDoc, 'participants'>;

/** Курсор очереди модерации: время (`lastReportAt` / `hiddenAt`) и id последней строки. */
export interface ModerationAfter {
  at: Date;
  id: string;
}

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
 * документом с условием в фильтре (`findOneAndUpdate`, без замков и чтения-проверки, `pokatim-db.md`): лимит мест,
 * статус, время, членство, владение, `version`. `null` — условие не выполнено; причину классифицирует сервис по
 * свежему чтению. «Я иду», правка и отмена идут в транзакции сервиса только ради события outbox (ADR-0017 п. 6) —
 * `session` передаётся в операцию. Значения фильтров — примитивы после zod.
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

  /** Поля уведомления о райде (`RideNotices`): название, старт, статус, организатор, участники — только `userId`. */
  findForNotice(
    id: string,
  ): Promise<Pick<
    RideDoc,
    '_id' | 'title' | 'startsAt' | 'status' | 'organizerUserId' | 'goingCount' | 'participants'
  > | null> {
    return this.rides.findOne(
      { _id: id },
      {
        projection: {
          title: 1,
          startsAt: 1,
          status: 1,
          organizerUserId: 1,
          goingCount: 1,
          'participants.userId': 1,
        },
      },
    );
  }

  /** Публичная карточка: опубликованный, отменённый и прошедший райд; скрытый — нет; без служебных полей. */
  async findPublic(id: string): Promise<RidePublicDoc | undefined> {
    return (
      (await this.rides.findOne<RidePublicDoc>(
        { _id: id, status: { $in: [...VISIBLE_STATUSES] } },
        { projection: PUBLIC_PROJECTION },
      )) ?? undefined
    );
  }

  /**
   * «Я иду»: будущий опубликованный райд, ещё не участник, есть место (`goingCount < limit ?? 100`) — всё в фильтре
   * одной операции: параллельные нажатия на последнее место не переберут лимит.
   */
  join(id: string, userId: string, now: Date, session?: DbSession): Promise<RideDoc | null> {
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
      { session, returnDocument: 'after' },
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
    session?: DbSession,
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
    return this.rides.findOneAndUpdate(filter, [{ $set: set }], {
      session,
      returnDocument: 'after',
    });
  }

  /**
   * Отмена организатором до старта, причина — из справочника (и при стирании аккаунта — `organizer_unavailable`,
   * `RideErasure`: та же операция по одному райду, событие — в её транзакции).
   */
  cancel(
    id: string,
    userId: string,
    reason: RideCancelReason,
    now: Date,
    session?: DbSession,
  ): Promise<RideDoc | null> {
    return this.rides.findOneAndUpdate(
      { _id: id, organizerUserId: userId, status: 'published', startsAt: { $gt: now } },
      {
        $set: { status: 'cancelled', cancelReason: reason, cancelledAt: now, updatedAt: now },
        $inc: { version: 1 },
      },
      { session, returnDocument: 'after' },
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
    // скрытый из опубликованного занимает слот до старта (8.1 Q2): нарушитель не освобождает квоту скрытием
    return this.rides.countDocuments({
      organizerUserId: userId,
      $or: [{ status: 'published' }, { status: 'hidden', hiddenFromStatus: 'published' }],
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

  // --- жалобы и модерация (05b): в транзакциях сервисов запись райда — первой (8.1 D2) ---

  /**
   * Жалоба: райд виден и не свой — `$inc openReportCount`, `$max lastReportAt` (поздний коммит не откатит время).
   * `null` — условие не выполнено (нет, скрыт, свой); причину классифицирует сервис по свежему чтению.
   */
  recordReport(tx: DbSession, id: string, userId: string, now: Date): Promise<RideDoc | null> {
    return this.rides.findOneAndUpdate(
      { _id: id, status: { $in: [...VISIBLE_STATUSES] }, organizerUserId: { $ne: userId } },
      { $inc: { openReportCount: 1 }, $max: { lastReportAt: now } },
      { session: tx, returnDocument: 'after', projection: { participants: 0 } },
    );
  }

  /** Состояние для модерации (без участников), в транзакции действия — с её снимком. */
  async findForModeration(id: string, tx?: DbSession): Promise<RideModerationDoc | undefined> {
    return (
      (await this.rides.findOne<RideModerationDoc>(
        { _id: id },
        { session: tx, projection: { participants: 0 } },
      )) ?? undefined
    );
  }

  /** «Скрыть» по `version` из `published`/`cancelled`: прежний статус — в `hiddenFromStatus`, `version + 1`. */
  hide(tx: DbSession, id: string, version: number, now: Date): Promise<RideModerationDoc | null> {
    return this.rides.findOneAndUpdate(
      { _id: id, version, status: { $in: [...VISIBLE_STATUSES] } },
      [
        {
          $set: {
            hiddenFromStatus: '$status',
            status: { $literal: 'hidden' },
            hiddenAt: { $literal: now },
            openReportCount: { $literal: 0 },
            updatedAt: { $literal: now },
            version: { $add: ['$version', 1] },
          },
        },
      ],
      { session: tx, returnDocument: 'after', projection: { participants: 0 } },
    );
  }

  /** «Вернуть» по `version` скрытый — в `hiddenFromStatus`, `version + 1`; жалобы не трогает. */
  restore(
    tx: DbSession,
    id: string,
    version: number,
    now: Date,
  ): Promise<RideModerationDoc | null> {
    return this.rides.findOneAndUpdate(
      { _id: id, version, status: 'hidden' },
      [
        {
          $set: {
            status: { $ifNull: ['$hiddenFromStatus', 'published'] },
            hiddenFromStatus: { $literal: null },
            hiddenAt: { $literal: null },
            updatedAt: { $literal: now },
            version: { $add: ['$version', 1] },
          },
        },
      ],
      { session: tx, returnDocument: 'after', projection: { participants: 0 } },
    );
  }

  /**
   * «Отклонить жалобы» по `version` и `lastReportAt` карточки (новая жалоба — `null`): нескрытый с открытыми
   * жалобами, `openReportCount = 0`; `version` не меняется.
   */
  clearReports(
    tx: DbSession,
    id: string,
    version: number,
    lastReportAt: Date,
  ): Promise<RideModerationDoc | null> {
    return this.rides.findOneAndUpdate(
      {
        _id: id,
        version,
        lastReportAt,
        status: { $in: [...VISIBLE_STATUSES] },
        openReportCount: { $gt: 0 },
      },
      { $set: { openReportCount: 0 } },
      { session: tx, returnDocument: 'after', projection: { participants: 0 } },
    );
  }

  /** Очередь «Открытые жалобы»: новые жалобы сверху (`rides_report_queue_idx`, условие частичного индекса). */
  listReported(after: ModerationAfter | null, limit: number): Promise<RideModerationDoc[]> {
    const filter: Filter<RideDoc> = { openReportCount: { $gt: 0 } };
    if (after) {
      filter.$or = [
        { lastReportAt: { $lt: after.at } },
        { lastReportAt: after.at, _id: { $lt: after.id } },
      ];
    }
    return this.rides
      .find<RideModerationDoc>(filter, { projection: { participants: 0 } })
      .sort({ lastReportAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Очередь «Скрытые»: недавно скрытые сверху (`rides_hidden_queue_idx`). */
  listHidden(after: ModerationAfter | null, limit: number): Promise<RideModerationDoc[]> {
    const filter: Filter<RideDoc> = { status: 'hidden' };
    if (after) {
      filter.$or = [
        { hiddenAt: { $lt: after.at } },
        { hiddenAt: after.at, _id: { $lt: after.id } },
      ];
    }
    return this.rides
      .find<RideModerationDoc>(filter, { projection: { participants: 0 } })
      .sort({ hiddenAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  // --- стирание удалённого аккаунта (`RideErasure`, ADR-0015, A6) ---
  // пакетные версии `cancel`/`leave`: условия — в фильтре, каждый документ меняется атомарно, повтор безопасен

  /** id будущих опубликованных райдов организатора — по одному отменяет `cancel` в своей транзакции с событием. */
  async futurePublishedIdsOf(organizerUserId: string, now: Date): Promise<string[]> {
    const docs = await this.rides
      .find(
        { organizerUserId, status: 'published', startsAt: { $gt: now } },
        { projection: { _id: 1 } },
      )
      .toArray();
    return docs.map((doc) => doc._id);
  }

  /**
   * Скрытые модерацией будущие райды организатора, скрытые из `published`: прежний статус → `cancelled` с причиной
   * `organizer_unavailable` (статус `hidden` не меняется): «Вернуть» покажет отменённый райд, а не живой райд
   * удалённого (F6).
   */
  async cancelHiddenFutureOf(organizerUserId: string, now: Date): Promise<number> {
    const result = await this.rides.updateMany(
      {
        organizerUserId,
        status: 'hidden',
        hiddenFromStatus: 'published',
        startsAt: { $gt: now },
      },
      {
        $set: {
          hiddenFromStatus: 'cancelled',
          cancelReason: 'organizer_unavailable',
          cancelledAt: now,
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
    );
    return result.modifiedCount;
  }

  /** «Не иду» во всех чужих будущих опубликованных и скрытых райдах, как `leave` (участие — без `version`). */
  async leaveAllFuture(userId: string, now: Date): Promise<number> {
    const result = await this.rides.updateMany(
      {
        'participants.userId': userId,
        organizerUserId: { $ne: userId },
        status: { $in: ['published', 'hidden'] },
        startsAt: { $gt: now },
      },
      {
        $pull: { participants: { userId } },
        $inc: { goingCount: -1 },
        $set: { updatedAt: now },
      },
    );
    return result.modifiedCount;
  }

  /** Подпись организатора стирается во всех его райдах (любой статус, A6). */
  async clearOrganizerName(organizerUserId: string, now: Date): Promise<number> {
    const result = await this.rides.updateMany(
      { organizerUserId, organizerName: { $ne: null } },
      { $set: { organizerName: null, updatedAt: now } },
    );
    return result.modifiedCount;
  }
}
