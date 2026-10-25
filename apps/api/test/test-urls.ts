// тестовая база — `<имя dev-БД>_test` в replica set из infra/docker-compose.dev.yml
const DB = 'pokatim';

/**
 * Тестовые адреса задаются только переменными *_TEST — dev-базу тесты не трогают. Отдельно от `test-env.ts`:
 * globalSetup выполняется в главном процессе vitest и не должен тянуть схему env (импорты workspace-пакетов).
 */
export const MONGO_URL_TEST =
  process.env.MONGO_URL_TEST ?? `mongodb://127.0.0.1:27017/${DB}_test?directConnection=true`;
export const REDIS_URL_TEST = process.env.REDIS_URL_TEST ?? 'redis://127.0.0.1:6379/1';
