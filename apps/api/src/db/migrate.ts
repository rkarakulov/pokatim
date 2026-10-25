import { mongoDatabaseName, runMongoMigrations } from '@rkarakulov/api-kit/mongo';
import { MongoClient } from 'mongodb';

import { loadMongoUrl } from '../config/env';
import { describeMigrateError } from './migrate-error';
import { migrations } from './migrations';

/**
 * `db:migrate` — отдельный шаг деплоя, не старт приложения: новые миграции по порядку, учёт в `_migrations`,
 * блокировка от параллельного запуска. Dev и CI — `tsx src/db/migrate.ts`, прод — `node dist/db/migrate.js`.
 */
async function migrate(): Promise<void> {
  const url = loadMongoUrl();
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
  try {
    const { applied } = await runMongoMigrations({
      db: client.db(mongoDatabaseName(url)),
      migrations,
    });
    process.stdout.write(
      applied.length > 0 ? `миграции применены: ${applied.join(', ')}\n` : 'новых миграций нет\n',
    );
  } finally {
    await client.close();
  }
}

migrate().catch((error: unknown) => {
  console.error(`db:migrate: ${describeMigrateError(error)}`);
  process.exitCode = 1;
});
