import { ensureOutboxIndexes, type MongoMigration } from '@rkarakulov/api-kit/mongo';

/** Коллекция outbox базы и частичный индекс неопубликованных событий (его использует публикатор). */
export const outbox: MongoMigration = {
  id: '0001_outbox',
  async up(db) {
    await ensureOutboxIndexes(db);
  },
};
