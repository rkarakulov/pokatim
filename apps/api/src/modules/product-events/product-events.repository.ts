import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import { type ProductEventDoc, productEventsCollections } from './product-events.collection';

/**
 * Единственный писатель `product_events`: вставка и стирание по `userId` (K13) — других update/delete нет
 * (append-only, сторож — `product-events.int.test.ts`).
 */
@Injectable()
export class ProductEventsRepository {
  private readonly events: Collection<ProductEventDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.events = productEventsCollections(db).events;
  }

  async insert(doc: ProductEventDoc, session?: DbSession): Promise<void> {
    await this.events.insertOne(doc, { session });
  }

  /** Стирание аккаунта — единственное исключение из append-only. */
  async deleteAllOf(userId: string): Promise<number> {
    return (await this.events.deleteMany({ userId })).deletedCount;
  }
}
