import type { MongoMigration } from '@rkarakulov/api-kit/mongo';
import type { CreateIndexesOptions, Db, IndexSpecification } from 'mongodb';

import { IDENTITY_COLLECTIONS } from '../../modules/identity/identity.collection';

type IndexDef = { key: IndexSpecification; options: CreateIndexesOptions & { name: string } };

/** Ссылка ещё действует: не использована и не заменена (частичные индексы «одна активная ссылка»). */
const activeLink = { usedAt: { $eq: null }, supersededAt: { $eq: null } };

/** Индексы ссылок из писем (подтверждение, сброс пароля): одинаковые, имена — по коллекции. */
const linkIndexes = (collection: string): IndexDef[] => [
  { key: { tokenHash: 1 }, options: { name: `${collection}_token_hash_unique`, unique: true } },
  // ключ отличается от частичного уникального ниже: у коллекции не два индекса на одном ключе
  { key: { userId: 1, createdAt: -1 }, options: { name: `${collection}_user_id_idx` } },
  {
    key: { userId: 1 },
    options: {
      name: `${collection}_active_unique`,
      unique: true,
      partialFilterExpression: activeLink,
    },
  },
];

/**
 * Коллекции и индексы identity (имена — из прежней схемы PostgreSQL: на них ссылаются `isDuplicateKey` и тесты).
 * Идемпотентна: существующая коллекция и тот же индекс повторно — без ошибки.
 */
export const IDENTITY_INDEXES: Record<string, IndexDef[]> = {
  [IDENTITY_COLLECTIONS.users]: [
    // полный, включая удалённые аккаунты: адрес удалённого не регистрируется заново (D-07)
    { key: { email: 1 }, options: { name: 'users_email_unique', unique: true } },
    // очистка неподтверждённых старше 7 дней (V-10)
    {
      key: { createdAt: 1 },
      options: {
        name: 'users_unverified_created_at_idx',
        partialFilterExpression: { emailVerifiedAt: { $eq: null }, deletedAt: { $eq: null } },
      },
    },
  ],
  [IDENTITY_COLLECTIONS.userConsents]: [
    { key: { userId: 1 }, options: { name: 'user_consents_user_id_idx' } },
  ],
  [IDENTITY_COLLECTIONS.emailVerificationTokens]: linkIndexes(
    IDENTITY_COLLECTIONS.emailVerificationTokens,
  ),
  [IDENTITY_COLLECTIONS.passwordResetTokens]: linkIndexes(IDENTITY_COLLECTIONS.passwordResetTokens),
  [IDENTITY_COLLECTIONS.registrationTokens]: [
    {
      key: { userId: 1 },
      options: { name: 'registration_tokens_user_id_unique', unique: true },
    },
    {
      key: { tokenHash: 1 },
      options: { name: 'registration_tokens_token_hash_unique', unique: true },
    },
  ],
  [IDENTITY_COLLECTIONS.sessions]: [
    {
      key: { refreshTokenHash: 1 },
      options: { name: 'sessions_refresh_token_hash_unique', unique: true },
    },
    {
      key: { previousRefreshTokenHash: 1 },
      options: {
        name: 'sessions_previous_refresh_token_hash_unique',
        unique: true,
        // `$type`, не `$exists`: явный `null` у ещё не ротированных сессий в индекс не попадает
        partialFilterExpression: { previousRefreshTokenHash: { $type: 'string' } },
      },
    },
    { key: { userId: 1 }, options: { name: 'sessions_user_id_idx' } },
  ],
};

/** Коллекция создаётся явно: в транзакции (первая регистрация) создание коллекции не нужно. */
export async function ensureCollection(db: Db, name: string): Promise<void> {
  const existing = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (existing.length === 0) await db.createCollection(name);
}

export const identity: MongoMigration = {
  id: '0002_identity',
  async up(db) {
    for (const [name, indexes] of Object.entries(IDENTITY_INDEXES)) {
      await ensureCollection(db, name);
      for (const { key, options } of indexes) {
        await db.collection(name).createIndex(key, options);
      }
    }
  },
};
