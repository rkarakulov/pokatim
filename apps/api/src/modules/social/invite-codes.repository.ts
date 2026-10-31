import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import { type InviteCodeDoc, socialCollections } from './social.collection';

/** Единственный писатель `invite_codes` (K9). Выдача кода — P6; в P0 — только стирание. */
@Injectable()
export class InviteCodesRepository {
  private readonly codes: Collection<InviteCodeDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.codes = socialCollections(db).inviteCodes;
  }

  async deleteOf(userId: string): Promise<number> {
    return (await this.codes.deleteOne({ _id: userId })).deletedCount;
  }
}
