import { Inject, Injectable } from '@nestjs/common';
import type { ReactionKind, ReactionTargetType } from '@pokatim/contracts';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { type ReactionDoc, socialCollections } from './social.collection';

/** Уникальная реакция (`0043_social`, RC-1): дубль вставки — уже есть (повтор или параллельное нажатие). */
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

  /** Стирание (K13): свои реакции и полученные. */
  async deleteAllOf(userId: string): Promise<number> {
    const own = await this.reactions.deleteMany({ actorId: userId });
    const received = await this.reactions.deleteMany({ recipientId: userId });
    return own.deletedCount + received.deletedCount;
  }
}
