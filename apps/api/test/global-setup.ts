import { recreateTestMongoDatabase } from '@rkarakulov/test-kit/mongo';

import { migrations } from '../src/db/migrations';
import { MONGO_URL_TEST } from './test-env';

/** Пересоздаёт тестовую базу (*_test) и прогоняет миграции — так же, как отдельный шаг деплоя. */
export default async function setup(): Promise<void> {
  await recreateTestMongoDatabase({ url: MONGO_URL_TEST, migrations });
}
