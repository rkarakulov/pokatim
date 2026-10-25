import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { IDENTITY_COLLECTIONS } from '../../modules/identity/identity.collection';

/** Срок хранения после истечения (Q2): отозванные сессии и использованные ссылки живут ещё 30 дней для аудита. */
export const IDENTITY_TTL_SECONDS = 30 * 24 * 3600;

/**
 * TTL-уборка истёкших сессий, ссылок из писем и токенов регистрации (Q2): документ удаляется фоновым TTL-монитором
 * MongoDB через 30 дней после `expiresAt`. Только уборка — истечение по-прежнему проверяет сервер по `CLOCK`.
 */
export const identityTtl: MongoMigration = {
  id: '0003_identity_ttl',
  async up(db) {
    for (const name of [
      IDENTITY_COLLECTIONS.sessions,
      IDENTITY_COLLECTIONS.emailVerificationTokens,
      IDENTITY_COLLECTIONS.passwordResetTokens,
      IDENTITY_COLLECTIONS.registrationTokens,
    ]) {
      await db
        .collection(name)
        .createIndex(
          { expiresAt: 1 },
          { name: `${name}_expires_at_ttl`, expireAfterSeconds: IDENTITY_TTL_SECONDS },
        );
    }
  },
};
