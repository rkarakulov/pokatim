import { Inject, Injectable } from '@nestjs/common';
import { isDuplicateKey, MONGO_DB } from '@rkarakulov/api-kit/mongo';
import type { Collection, Db } from 'mongodb';

import type { DbSession } from '../../db';
import {
  APPEARANCE_SETTINGS_ID,
  appearanceCollections,
  type AppearanceSettingsDoc,
} from './appearance.collection';

/**
 * Единственный писатель документа `platform_settings/appearance`. Изменение — по ожидаемой `version` в фильтре;
 * значения — примитивы после zod.
 */
@Injectable()
export class AppearanceRepository {
  private readonly settings: Collection<AppearanceSettingsDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.settings = appearanceCollections(db).settings;
  }

  async find(session?: DbSession): Promise<AppearanceSettingsDoc | undefined> {
    return (await this.settings.findOne({ _id: APPEARANCE_SETTINGS_ID }, { session })) ?? undefined;
  }

  /** Первая запись настройки; `false` — документ уже вставлен параллельно. */
  async insert(session: DbSession, doc: AppearanceSettingsDoc): Promise<boolean> {
    try {
      await this.settings.insertOne(doc, { session });
      return true;
    } catch (error) {
      if (isDuplicateKey(error, '_id_')) return false;
      throw error;
    }
  }

  /** Изменение с ожидаемой версией; `null` — устарело. */
  update(
    session: DbSession,
    expectedVersion: number,
    set: Partial<Pick<AppearanceSettingsDoc, 'themeId' | 'decor'>> &
      Pick<AppearanceSettingsDoc, 'updatedAt'>,
  ): Promise<AppearanceSettingsDoc | null> {
    return this.settings.findOneAndUpdate(
      { _id: APPEARANCE_SETTINGS_ID, version: expectedVersion },
      { $set: set, $inc: { version: 1 } },
      { session, returnDocument: 'after' },
    );
  }
}
