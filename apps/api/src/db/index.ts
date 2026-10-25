/**
 * БД проекта — MongoDB (`.claude/rules/db.md`). Транзакция — `MongoTransactions.run((session) => …)`; репозитории
 * принимают `session?: DbSession` и передают `{ session }` в каждую операцию, чтобы сервис собирал шаги в одну
 * транзакцию. Коллекции модулей (имя + интерфейс документа) — в `modules/<context>/*.collection.ts`, индексы —
 * только миграциями (`db/migrations`).
 */
export type { ClientSession as DbSession } from 'mongodb';
export {
  MongoTransactions,
  OUTBOX_COLLECTION,
  type MongoOutboxDoc,
} from '@rkarakulov/api-kit/mongo';
