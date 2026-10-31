import { Inject, Injectable } from '@nestjs/common';
import { MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import { type InviteCodeDoc, socialCollections } from './social.collection';

/** Уникальный код (`0045_social`): дубль при вставке — новый код (`InviteCodes.ensureOf`). */
export const INVITE_CODES_CODE_UNIQUE_INDEX = 'invite_codes_code_unique';

/** Единственный писатель `invite_codes` (K9): выдача кода (P6, `_id` = userId), разрешение кода, стирание. */
@Injectable()
export class InviteCodesRepository {
  private readonly codes: Collection<InviteCodeDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.codes = socialCollections(db).inviteCodes;
  }

  async findCode(userId: string): Promise<string | undefined> {
    return (await this.codes.findOne({ _id: userId }, { projection: { code: 1 } }))?.code;
  }

  /** Вставка кода; дубль `_id_` — код уже выдан параллельно, дубль кода — коллизия (решает вызывающий). */
  async insert(userId: string, code: string, now: Date): Promise<void> {
    await this.codes.insertOne({ _id: userId, code, createdAt: now });
  }

  /** Владелец кода (`invite_codes_code_unique`). */
  async ownerOf(code: string): Promise<string | undefined> {
    return (await this.codes.findOne({ code }, { projection: { _id: 1 } }))?._id;
  }

  async deleteOf(userId: string): Promise<number> {
    return (await this.codes.deleteOne({ _id: userId })).deletedCount;
  }
}
