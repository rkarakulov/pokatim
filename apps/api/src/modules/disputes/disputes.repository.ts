import { Inject, Injectable } from '@nestjs/common';
import type { DisputeStatus } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db, Filter } from 'mongodb';

import type { DbSession } from '../../db';
import { type DisputeDoc, type DisputeEventDoc, disputesCollections } from './disputes.collection';

/** Индекс «один спор на (гонка, заявитель, цель)» — дубль подачи (`isDuplicateKey`). */
export const DISPUTES_PAIR_UNIQUE_INDEX = 'disputes_pair_unique';

/** Позиция строки списка панели (курсор): `(filedAt, _id)` по убыванию. */
export interface DisputePosition {
  filedAt: Date;
  id: string;
}

/**
 * Единственный писатель `disputes` и `dispute_events` (RC-8):
 * - спор — вставка и переходы **только из `open`** (`updateOne` с `status: 'open'` в фильтре; `$set` — только
 *   `status`/`response`/`decision`/`closedAt`/`updatedAt`, `$inc version`); содержание подачи не меняется, удалений и
 *   замен нет;
 * - история — только `insertOne`.
 * Сторож — `disputes.repository.test.ts`. Значения фильтров — примитивы после zod.
 */
@Injectable()
export class DisputesRepository {
  private readonly disputes: Collection<DisputeDoc>;
  private readonly events: Collection<DisputeEventDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    const collections = disputesCollections(db);
    this.disputes = collections.disputes;
    this.events = collections.events;
  }

  // --- подача и переходы (в транзакциях сервисов) ---

  /** Подача; повтор пары ловит уникальный индекс `disputes_pair_unique` (E11000). */
  async insert(tx: DbSession, doc: DisputeDoc): Promise<void> {
    await this.disputes.insertOne(doc, { session: tx });
  }

  /** Отзыв заявителем: только открытый и свой; `null` — переход не выполнен. */
  withdraw(
    tx: DbSession,
    id: string,
    complainantUserId: string,
    now: Date,
  ): Promise<DisputeDoc | null> {
    return this.transition(
      tx,
      { _id: id, complainantUserId, status: 'open' },
      { status: 'withdrawn', closedAt: now, updatedAt: now },
    );
  }

  /** Ответ участника-цели: только открытый, свой и без ответа; `null` — переход не выполнен. */
  respond(
    tx: DbSession,
    id: string,
    targetUserId: string,
    text: string,
    now: Date,
  ): Promise<DisputeDoc | null> {
    return this.transition(
      tx,
      { _id: id, targetUserId, status: 'open', response: null },
      { response: { text, at: now }, updatedAt: now },
    );
  }

  /** Решение: только открытый; статус — исход, `closedAt = now`; `null` — переход не выполнен. */
  decide(
    tx: DbSession,
    id: string,
    decision: NonNullable<DisputeDoc['decision']>,
    now: Date,
  ): Promise<DisputeDoc | null> {
    return this.transition(
      tx,
      { _id: id, status: 'open' },
      { status: decision.outcome, decision, closedAt: now, updatedAt: now },
    );
  }

  /** Переход из `open`: условная запись и чтение результата в той же транзакции. */
  private async transition(
    tx: DbSession,
    filter: Filter<DisputeDoc> & { status: 'open' },
    set: Partial<Pick<DisputeDoc, 'status' | 'response' | 'decision' | 'closedAt' | 'updatedAt'>>,
  ): Promise<DisputeDoc | null> {
    const updated = await this.disputes.updateOne(
      filter,
      { $set: set, $inc: { version: 1 } },
      { session: tx },
    );
    if (updated.matchedCount !== 1) return null;
    return this.disputes.findOne({ _id: filter._id }, { session: tx });
  }

  /** История — только вставка. */
  async insertEvent(tx: DbSession, doc: DisputeEventDoc): Promise<void> {
    await this.events.insertOne(doc, { session: tx });
  }

  // --- чтения ---

  findById(id: string, session?: DbSession): Promise<DisputeDoc | null> {
    return this.disputes.findOne({ _id: id }, { session });
  }

  /** Стороны спора для уведомлений (`DisputeNotices`): проекция без описания, ответа и решения. */
  findParties(
    id: string,
  ): Promise<Pick<DisputeDoc, 'raceId' | 'complainantUserId' | 'targetUserId'> | null> {
    return this.disputes.findOne(
      { _id: id },
      { projection: { _id: 0, raceId: 1, complainantUserId: 1, targetUserId: 1 } },
    );
  }

  /** Мои споры как заявителя в гонке, новые сверху (префикс `disputes_pair_unique`). */
  listFiledBy(raceId: string, complainantUserId: string): Promise<DisputeDoc[]> {
    return this.disputes
      .find({ raceId, complainantUserId })
      .sort({ filedAt: -1, _id: -1 })
      .toArray();
  }

  /** Споры по заявке-цели, новые сверху (`disputes_target_idx`). */
  listAgainst(targetEntryId: string): Promise<DisputeDoc[]> {
    return this.disputes.find({ targetEntryId }).sort({ filedAt: -1, _id: -1 }).toArray();
  }

  /** Открытые споры заявителя в гонке (лимит; подачи гонки сериализует `lockResults`). */
  countOpenByComplainant(
    tx: DbSession,
    raceId: string,
    complainantUserId: string,
  ): Promise<number> {
    return this.disputes.countDocuments(
      { raceId, complainantUserId, status: 'open' },
      { session: tx },
    );
  }

  /** Открытые споры против заявки (D-39). */
  countOpenAgainst(entryId: string, session?: DbSession): Promise<number> {
    return this.disputes.countDocuments({ targetEntryId: entryId, status: 'open' }, { session });
  }

  /** Все открытые споры — очередь «Споров» (admin-overview, индекс `disputes_queue_idx`). */
  countOpen(): Promise<number> {
    return this.disputes.countDocuments({ status: 'open' });
  }

  /** Открытые споры гонки (чек-лист публикации, D-19). */
  countOpenInRace(raceId: string, session?: DbSession): Promise<number> {
    return this.disputes.countDocuments({ raceId, status: 'open' }, { session });
  }

  /** Открытые споры по гонкам страницы — одна агрегация; гонки без споров в карте отсутствуют. */
  async countOpenByRace(raceIds: readonly string[]): Promise<Map<string, number>> {
    if (raceIds.length === 0) return new Map();
    const rows = await this.disputes
      .aggregate<{ _id: string; count: number }>([
        { $match: { raceId: { $in: [...raceIds] }, status: 'open' } },
        { $group: { _id: '$raceId', count: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [row._id, row.count]));
  }

  /**
   * Список панели по `(filedAt, _id)` убыв. после позиции `after` (индексы `disputes_race_idx`, `disputes_queue_idx`,
   * `disputes_all_idx`).
   */
  page(
    query: { status?: DisputeStatus; raceId?: string },
    after: DisputePosition | null,
    limit: number,
  ): Promise<DisputeDoc[]> {
    const filter: Filter<DisputeDoc> = {};
    if (query.raceId) filter.raceId = query.raceId;
    if (query.status) filter.status = query.status;
    if (after) {
      filter.$or = [
        { filedAt: { $lt: after.filedAt } },
        { filedAt: after.filedAt, _id: { $lt: after.id } },
      ];
    }
    return this.disputes.find(filter).sort({ filedAt: -1, _id: -1 }).limit(limit).toArray();
  }

  /** История спора по `(at, _id)` — `uuidv7` не монотонен внутри миллисекунды. */
  listEvents(disputeId: string): Promise<DisputeEventDoc[]> {
    return this.events.find({ disputeId }).sort({ at: 1, _id: 1 }).toArray();
  }
}
