import { Inject, Injectable } from '@nestjs/common';
import type { AttendanceVia } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { type AttendanceDoc, type AttendanceEntry, socialCollections } from './social.collection';

/**
 * Единственный писатель `ride_attendance` (RC-2a): документ на райд, одна запись на райдера. Каждая отметка — в
 * транзакции сервиса **первой** операцией: условная запись в документ райда, затем чтение явившихся. Параллельные
 * отметки одного райда конфликтуют по документу, и `MongoTransactions.run` повторяет проигравшую на свежем снимке —
 * пересчёт связей видит всех. `true` — запись изменила явку (иначе — повтор, no-op).
 */
@Injectable()
export class AttendanceRepository {
  private readonly attendance: Collection<AttendanceDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.attendance = socialCollections(db).attendance;
  }

  /** Документ райда без записей — upsert только по `_id` (существующий не меняется, дубля `_id` нет). */
  private async ensure(tx: DbSession, rideId: string, now: Date): Promise<void> {
    await this.attendance.updateOne(
      { _id: rideId },
      { $setOnInsert: { entries: [], updatedAt: now } },
      { upsert: true, session: tx },
    );
  }

  private async push(tx: DbSession, rideId: string, entry: AttendanceEntry): Promise<boolean> {
    const result = await this.attendance.updateOne(
      { _id: rideId, 'entries.userId': { $ne: entry.userId } },
      { $push: { entries: entry }, $set: { updatedAt: entry.at } },
      { session: tx },
    );
    return result.modifiedCount > 0;
  }

  /**
   * «Я был на райде»: записи нет — новая явка; есть с `declinedAt` — явка снова (RC-3a). Явка уже есть (любая) —
   * no-op.
   */
  async markManual(tx: DbSession, rideId: string, userId: string, now: Date): Promise<boolean> {
    await this.ensure(tx, rideId, now);
    const revived = await this.attendance.updateOne(
      { _id: rideId, entries: { $elemMatch: { userId, declinedAt: { $ne: null } } } },
      {
        $set: {
          'entries.$.via': 'manual' satisfies AttendanceVia,
          'entries.$.at': now,
          'entries.$.declinedAt': null,
          updatedAt: now,
        },
      },
      { session: tx },
    );
    if (revived.modifiedCount > 0) return true;
    return this.push(tx, rideId, { userId, via: 'manual', at: now, declinedAt: null });
  }

  /** Явка по треку (K2): только если записи нет — «Меня не было» (`declinedAt`) и прежняя явка не перекрываются. */
  async markByTrack(tx: DbSession, rideId: string, userId: string, now: Date): Promise<boolean> {
    await this.ensure(tx, rideId, now);
    return this.push(tx, rideId, { userId, via: 'track', at: now, declinedAt: null });
  }

  /**
   * «Меня не было» (RC-3a): явка (ручная или по треку) → `declinedAt`; записи нет — запись с `declinedAt`, чтобы
   * поздний трек не поставил явку. Уже снята — no-op.
   */
  async decline(tx: DbSession, rideId: string, userId: string, now: Date): Promise<boolean> {
    await this.ensure(tx, rideId, now);
    const declined = await this.attendance.updateOne(
      { _id: rideId, entries: { $elemMatch: { userId, declinedAt: null } } },
      { $set: { 'entries.$.declinedAt': now, updatedAt: now } },
      { session: tx },
    );
    if (declined.modifiedCount > 0) return true;
    return this.push(tx, rideId, { userId, via: 'manual', at: now, declinedAt: now });
  }

  /** Явившиеся райда (`declinedAt: null`) в порядке записи. */
  async attendees(rideId: string, tx?: DbSession): Promise<string[]> {
    return (await this.entriesIn(rideId, tx))
      .filter((entry) => entry.declinedAt === null)
      .map((entry) => entry.userId);
  }

  /** Записи явки райда в сессии вызывающего (P5: адресаты в транзакции захвата); документа нет — `[]`. */
  async entriesIn(rideId: string, tx?: DbSession): Promise<AttendanceEntry[]> {
    const doc = await this.attendance.findOne({ _id: rideId }, { session: tx });
    return (doc?.entries ?? []).map((entry) => ({
      ...entry,
      declinedAt: entry.declinedAt ?? null,
    }));
  }

  /**
   * Захват «Как прошёл райд?» (P5, RC-P5-9) — запись в документ явки райда: параллельная отметка явки конфликтует с
   * ним, и `MongoTransactions.run` повторяет проигравшую. `true` — захвачено сейчас; `false` — уже спрошен. Нет поля —
   * как `null`; `updatedAt` не меняется.
   */
  async claimAsk(tx: DbSession, rideId: string, now: Date): Promise<boolean> {
    await this.ensure(tx, rideId, now);
    const claimed = await this.attendance.updateOne(
      { _id: rideId, askedAt: null },
      { $set: { askedAt: now } },
      { session: tx },
    );
    return claimed.modifiedCount > 0;
  }

  /** Уже спрошенные райды из `rideIds` — предфильтр регламента без транзакции. */
  async askedAmong(rideIds: readonly string[]): Promise<Set<string>> {
    if (rideIds.length === 0) return new Set();
    const docs = await this.attendance
      .find({ _id: { $in: [...rideIds] }, askedAt: { $ne: null } }, { projection: { _id: 1 } })
      .toArray();
    return new Set(docs.map((doc) => doc._id));
  }

  /** Записи явки райда (P2, ответ участников): без сессии; документа нет — `[]`. */
  async entriesOf(rideId: string): Promise<AttendanceEntry[]> {
    const doc = await this.attendance.findOne({ _id: rideId });
    return (doc?.entries ?? []).map((entry) => ({
      ...entry,
      declinedAt: entry.declinedAt ?? null,
    }));
  }

  /** Стирание (K13): записи райдера во всех райдах — без пересчёта связей других (RC-7). */
  async pullUser(userId: string): Promise<number> {
    const result = await this.attendance.updateMany(
      { 'entries.userId': userId },
      { $pull: { entries: { userId } } },
    );
    return result.modifiedCount;
  }
}
