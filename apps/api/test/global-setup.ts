import { recreateTestMongoDatabase } from '@rkarakulov/test-kit/mongo';
import { MongoClient } from 'mongodb';

import { migrations } from '../src/db/migrations';
import { MONGO_URL_TEST } from './test-urls';

/**
 * Пересоздаёт тестовую базу (*_test) и прогоняет миграции — так же, как отдельный шаг деплоя. Монитор TTL сервера
 * выключен: он удаляет по настенным часам, а `expiresAt` тестов — по `TestClock` (в прошлом), и документ исчезал
 * между шагами теста, когда монитор просыпался (раз в 60 с) — флак тикета `devices` (`complete` → 400).
 */
export default async function setup(): Promise<void> {
  await recreateTestMongoDatabase({ url: MONGO_URL_TEST, migrations });
  const client = await MongoClient.connect(MONGO_URL_TEST);
  try {
    await client.db('admin').command({ setParameter: 1, ttlMonitorEnabled: false });
  } finally {
    await client.close();
  }
}
