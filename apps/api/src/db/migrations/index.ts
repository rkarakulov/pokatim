import type { MongoMigration } from '@rkarakulov/api-kit/mongo';

import { outbox } from './0001_outbox';
import { identity } from './0002_identity';
import { identityTtl } from './0003_identity_ttl';
import { profile } from './0004_profile';

/**
 * Миграции MongoDB по порядку (`db:migrate`, `.claude/rules/db.md`): новая — в конец списка, применённые не
 * меняются. Стенд тестов прогоняет этот же список на чистой `*_test`.
 */
export const migrations: readonly MongoMigration[] = [outbox, identity, identityTtl, profile];
