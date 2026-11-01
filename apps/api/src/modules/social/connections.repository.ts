import { Inject, Injectable } from '@nestjs/common';
import { isDuplicateKey, MONGO_DB, uuidv7 } from '@rkarakulov/api-kit/mongo';
import type { AnyBulkWriteOperation, Collection, Db, Filter } from 'mongodb';

import type { DbSession } from '../../db';
import { type ConnectionPair, SOCIAL_POLICY } from './social.policy';
import { type ConnectionDoc, socialCollections } from './social.collection';

/**
 * Уникальная пара связи (`0045_social`). Параллельные upsert одной пары в транзакциях (`addManual`, `linkInvite`,
 * пересчёт явки) приходят как `112 WriteConflict` и повторяются `withTransaction` (RC-P3-2); `isDuplicateKey` — только у
 * `remove` вне транзакции («уже убран»).
 */
export const CONNECTIONS_UNIQUE_INDEX = 'rider_connections_owner_other_unique';

/** Итог `upsertInvite` для одной стороны пары. */
export type InviteUpsert = 'inserted' | 'invited' | 'unchanged';

/** Поля нового документа связи без райдов (`$setOnInsert`); источники и `removedAt` задаёт операция явно. */
const fresh = (now: Date) => ({
  _id: uuidv7(),
  createdAt: now,
  rides: [],
  rideCount: 0,
  lastRideAt: null,
});

/** Документ связи без источников и не удалённый вручную (надгробие `removedAt` остаётся, RC-6). */
const EMPTY: Filter<ConnectionDoc> = {
  removedAt: null,
  rides: { $size: 0 },
  inviteAt: null,
  manualAt: null,
};

/**
 * Единственный писатель `rider_connections`. Пересчёт связей `ride` идёт в транзакции явки после записи документа
 * явки райда (`AttendanceRepository`), поэтому его операции не сериализуют сами себя. Ручные операции — один документ
 * пары. Значения фильтров — примитивы; pipeline-обновления — только с `$literal`.
 */
@Injectable()
export class ConnectionsRepository {
  private readonly connections: Collection<ConnectionDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.connections = socialCollections(db).connections;
  }

  /**
   * «В свои» (K1): upsert пары, `manualAt = now`, `removedAt = null`. `created` — документ создан, `connectedBefore` —
   * связь уже была и не убрана (любой источник; K11, P7: тогда без уведомления).
   */
  async upsertManual(
    tx: DbSession,
    pair: ConnectionPair,
    now: Date,
  ): Promise<{ created: boolean; connectedBefore: boolean }> {
    const before = await this.connections.findOneAndUpdate(
      pair,
      {
        $set: { manualAt: now, removedAt: null, updatedAt: now },
        $setOnInsert: { ...fresh(now), inviteAt: null },
      },
      { upsert: true, session: tx, returnDocument: 'before', projection: { removedAt: 1 } },
    );
    return {
      created: before === null,
      connectedBefore: before !== null && before.removedAt === null,
    };
  }

  /**
   * K11 (P7): отметка уведомления о ручном добавлении пары — если прошлого не было (`manualNoticeAt` нет или `null`)
   * или оно старше `renotifyMs`. `true` — отметка поставлена, уведомлять.
   */
  async claimManualNotice(
    tx: DbSession,
    pair: ConnectionPair,
    now: Date,
    renotifyMs: number,
  ): Promise<boolean> {
    const result = await this.connections.updateOne(
      {
        ...pair,
        $or: [
          { manualNoticeAt: null },
          { manualNoticeAt: { $lte: new Date(now.getTime() - renotifyMs) } },
        ],
      },
      { $set: { manualNoticeAt: now } },
      { session: tx },
    );
    return result.modifiedCount > 0;
  }

  /**
   * «Убрать из своих» (K1, RC-6): `removedAt = now`, `manualAt = null`; документ остаётся. Upsert — надгробие
   * появляется, даже если параллельный пересчёт явки только что удалил документ без источников. Уже убран — дубль
   * уникальной пары, no-op.
   */
  async remove(pair: ConnectionPair, now: Date): Promise<boolean> {
    try {
      const result = await this.connections.updateOne(
        { ...pair, removedAt: null },
        {
          $set: { removedAt: now, manualAt: null, updatedAt: now },
          $setOnInsert: { ...fresh(now), inviteAt: null },
        },
        { upsert: true },
      );
      return result.modifiedCount > 0 || result.upsertedCount > 0;
    } catch (error) {
      if (isDuplicateKey(error, CONNECTIONS_UNIQUE_INDEX)) return false;
      throw error;
    }
  }

  /**
   * Связь `invite` (K9): upsert пары; `inviteAt` ставится, если его не было; `removedAt` не трогается. `inserted` —
   * документ создан, `invited` — у существующего `inviteAt` впервые стал не-`null` (RC-P6-8), `unchanged` — уже был.
   */
  async upsertInvite(tx: DbSession, pair: ConnectionPair, now: Date): Promise<InviteUpsert> {
    const result = await this.connections.updateOne(
      pair,
      {
        $setOnInsert: {
          ...fresh(now),
          inviteAt: now,
          manualAt: null,
          removedAt: null,
          updatedAt: now,
        },
      },
      { upsert: true, session: tx },
    );
    if (result.upsertedCount > 0) return 'inserted';
    const invited = await this.connections.updateOne(
      { ...pair, inviteAt: null },
      { $set: { inviteAt: now, updatedAt: now } },
      { session: tx },
    );
    return invited.modifiedCount > 0 ? 'invited' : 'unchanged';
  }

  /** Пары, у которых райд уже среди общих (`rider_connections_ride_idx`). */
  pairsOfRide(rideId: string, tx: DbSession): Promise<ConnectionPair[]> {
    return this.connections
      .find(
        { 'rides.rideId': rideId },
        { projection: { _id: 0, ownerId: 1, otherId: 1 }, session: tx },
      )
      .toArray();
  }

  /**
   * Пересчёт связей `ride` райда пачками (`bulkBatch`): `add` — upsert пары с райдом (`rides` без этого райда плюс
   * новая запись, `rideCount = $size`, `lastRideAt = $max`), `remove` — то же без добавления; затем удаление
   * затронутых пар без источников (кроме надгробий `removedAt`). Возвращает созданные пары (событие
   * `connection-created`).
   */
  async applyRideDiff(
    tx: DbSession,
    rideId: string,
    rideAt: Date,
    diff: { add: readonly ConnectionPair[]; remove: readonly ConnectionPair[] },
    now: Date,
    batch: number,
  ): Promise<ConnectionPair[]> {
    const others = {
      $filter: { input: '$rides', cond: { $ne: ['$$this.rideId', { $literal: rideId }] } },
    };
    const recount = {
      $set: {
        rideCount: { $size: '$rides' },
        lastRideAt: { $ifNull: [{ $max: '$rides.at' }, null] },
        updatedAt: { $literal: now },
      },
    };
    const created: ConnectionPair[] = [];
    const ops: { pair: ConnectionPair; op: AnyBulkWriteOperation<ConnectionDoc> }[] = [
      ...diff.add.map((pair) => ({
        pair,
        op: {
          updateOne: {
            filter: pair,
            update: [
              {
                $set: {
                  _id: { $ifNull: ['$_id', { $literal: uuidv7() }] },
                  createdAt: { $ifNull: ['$createdAt', { $literal: now }] },
                  inviteAt: { $ifNull: ['$inviteAt', null] },
                  manualAt: { $ifNull: ['$manualAt', null] },
                  removedAt: { $ifNull: ['$removedAt', null] },
                  rides: {
                    $concatArrays: [
                      { $ifNull: [others, []] },
                      [{ rideId: { $literal: rideId }, at: { $literal: rideAt } }],
                    ],
                  },
                },
              },
              recount,
            ],
            upsert: true,
          },
        } satisfies AnyBulkWriteOperation<ConnectionDoc>,
      })),
      ...diff.remove.map((pair) => ({
        pair,
        op: {
          updateOne: {
            filter: pair,
            update: [{ $set: { rides: { $ifNull: [others, []] } } }, recount],
          },
        } satisfies AnyBulkWriteOperation<ConnectionDoc>,
      })),
    ];
    for (let start = 0; start < ops.length; start += batch) {
      const chunk = ops.slice(start, start + batch);
      const result = await this.connections.bulkWrite(
        chunk.map((item) => item.op),
        { ordered: true, session: tx },
      );
      for (const index of Object.keys(result.upsertedIds)) {
        const item = chunk[Number(index)];
        if (item) created.push(item.pair);
      }
    }
    for (let start = 0; start < diff.remove.length; start += batch) {
      const chunk = diff.remove.slice(start, start + batch);
      await this.connections.deleteMany({ ...EMPTY, $or: [...chunk] }, { session: tx });
    }
    return created;
  }

  /** Связи владельца, не убранные вручную (K6). */
  listOf(ownerId: string): Promise<ConnectionDoc[]> {
    return this.connections
      .find({ ownerId, removedAt: null })
      .sort({ lastRideAt: -1, updatedAt: -1, _id: -1 })
      .toArray();
  }

  findPair(pair: ConnectionPair): Promise<ConnectionDoc | null> {
    return this.connections.findOne(pair);
  }

  /** Связь пары есть и не убрана (`owner_other_unique`, P7). */
  async isConnected(pair: ConnectionPair): Promise<boolean> {
    return (await this.connections.countDocuments({ ...pair, removedAt: null }, { limit: 1 })) > 0;
  }

  /** Владельцы не убранных связей к `otherId` (`rider_connections_other_idx`, P7: «Свои идут»). */
  async ownerIdsOf(otherId: string): Promise<string[]> {
    const docs = await this.connections
      .find({ otherId, removedAt: null }, { projection: { _id: 0, ownerId: 1 } })
      .toArray();
    return docs.map((doc) => doc.ownerId);
  }

  /** Кто из `ownerIds` держит не убранную связь к `otherId` (`owner_other_unique`, P7: взаимность Главной). */
  async ownersAmong(otherId: string, ownerIds: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let start = 0; start < ownerIds.length; start += SOCIAL_POLICY.bulkBatch) {
      const chunk = ownerIds.slice(start, start + SOCIAL_POLICY.bulkBatch);
      const docs = await this.connections
        .find(
          { ownerId: { $in: [...chunk] }, otherId, removedAt: null },
          { projection: { _id: 0, ownerId: 1 } },
        )
        .toArray();
      for (const doc of docs) found.add(doc.ownerId);
    }
    return found;
  }

  /** Кто из `otherIds` у владельца в не убранных связях (`owner_other_unique`, P7: взаимность RC-P7-1a). */
  async otherIdsAmong(ownerId: string, otherIds: readonly string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let start = 0; start < otherIds.length; start += SOCIAL_POLICY.bulkBatch) {
      const chunk = otherIds.slice(start, start + SOCIAL_POLICY.bulkBatch);
      const docs = await this.connections
        .find(
          { ownerId, otherId: { $in: [...chunk] }, removedAt: null },
          { projection: { _id: 0, otherId: 1 } },
        )
        .toArray();
      for (const doc of docs) found.add(doc.otherId);
    }
    return found;
  }

  /** Стирание (K13): связи райдера в обе стороны. */
  async deleteAllOf(userId: string): Promise<number> {
    const own = await this.connections.deleteMany({ ownerId: userId });
    const toMe = await this.connections.deleteMany({ otherId: userId });
    return own.deletedCount + toMe.deletedCount;
  }
}
