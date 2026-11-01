import { Inject, Injectable } from '@nestjs/common';
import type { ReactionKind, ReactionTargetType } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { type ReactionDoc, socialCollections } from './social.collection';

/** Уникальная реакция (`0045_social`, RC-1): дубль вставки — уже есть (повтор или параллельное нажатие). */
export const REACTIONS_UNIQUE_INDEX = 'social_reactions_unique';

/** Ключ реакции — поля уникального индекса. */
export interface ReactionKey {
  kind: ReactionKind;
  actorId: string;
  targetType: ReactionTargetType;
  targetId: string;
  recipientId: string;
}

/** Единственный писатель `social_reactions`: вставка, снятие своей, стирание; счётчики — `countDocuments` на чтении. */
@Injectable()
export class ReactionsRepository {
  private readonly reactions: Collection<ReactionDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.reactions = socialCollections(db).reactions;
  }

  async insert(tx: DbSession, doc: ReactionDoc): Promise<void> {
    await this.reactions.insertOne(doc, { session: tx });
  }

  /** Реакция по id (P7, `SOCIAL_NOTICES`): снята или стёрта — `null`. */
  findById(id: string): Promise<ReactionDoc | null> {
    return this.reactions.findOne({ _id: id });
  }

  async exists(key: ReactionKey): Promise<boolean> {
    return (await this.reactions.countDocuments(key, { limit: 1 })) > 0;
  }

  async delete(key: ReactionKey): Promise<boolean> {
    return (await this.reactions.deleteOne(key)).deletedCount > 0;
  }

  /** Счётчик по цели (`social_reactions_target_idx`). */
  count(targetType: ReactionTargetType, targetId: string, kind: ReactionKind): Promise<number> {
    return this.reactions.countDocuments({ targetType, targetId, kind });
  }

  /** Получатели реакций актёра на цели (P4: «спасибо» зрителя на райде) — префикс `social_reactions_unique`. */
  async recipientsOf(
    actorId: string,
    kind: ReactionKind,
    targetType: ReactionTargetType,
    targetId: string,
  ): Promise<Set<string>> {
    const docs = await this.reactions
      .find({ actorId, kind, targetType, targetId }, { projection: { _id: 0, recipientId: 1 } })
      .toArray();
    return new Set(docs.map((doc) => doc.recipientId));
  }

  /** Актёры реакций вида на цели, новые сверху, не больше `limit` (P4: `from` «Респекта» получателю). */
  async actorsOf(
    targetType: ReactionTargetType,
    targetId: string,
    kind: ReactionKind,
    limit: number,
  ): Promise<string[]> {
    const docs = await this.reactions
      .find({ targetType, targetId, kind }, { projection: { _id: 0, actorId: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => doc.actorId);
  }

  /** Стирание (K13): свои реакции и полученные. */
  async deleteAllOf(userId: string): Promise<number> {
    const own = await this.reactions.deleteMany({ actorId: userId });
    const received = await this.reactions.deleteMany({ recipientId: userId });
    return own.deletedCount + received.deletedCount;
  }
}
