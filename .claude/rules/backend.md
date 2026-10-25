---
paths:
  - "apps/api/**"
---

# Backend — apps/api (NestJS на Fastify)

Процесс: скил `app-dev-kit:backend-nest`. Канон: `AGENTS.md` §4.

## Placement

- Модуль = ограниченный контекст: `src/modules/<context>/` (образец — `health`).
- Внутри модуля: `*.controller.ts` (тонкий: валидация по контракту, вызов сервиса) →
  `*.service.ts` (бизнес-логика) → `*.repository.ts` (драйвер MongoDB, коллекции — `*.collection.ts`); `jobs/*.processor.ts` (BullMQ);
  `index.ts` — публичный API модуля.
- Чужой модуль — только через его `index.ts`. Циклы модулей запрещены (без `forwardRef`).
- Общая инфраструктура (env, db, outbox, redis, queue, mail, http, ошибки) — `@rkarakulov/api-kit/core` и
  `@rkarakulov/api-kit/mongo`; она не знает о модулях. В `src/` — только композиция: `config/env.ts`
  (`defineCoreEnv`), `db/` (транзакции, миграции), `queues.ts`,
  `error-messages.ts`, `app.module.ts`/`worker.module.ts`. Нужно изменить инфраструктуру — задача в app-foundation.

## Правила

- DTO не пишутся руками: zod-схема из `@pokatim/contracts` → pipe валидации.
- Ошибки — коды из contracts (`ErrorCode`), тексты — `error-messages.ts`; без утечки стека и запросов БД наружу.
- Итоговые и вычисляемые значения (статусы, суммы, рейтинги) считает только сервер; клиентским — не доверяем.
- Тяжёлая и асинхронная работа — в `src/worker.ts` через BullMQ (`queues.ts`). HTTP-обработчик только ставит задачу.
- Задачи идемпотентны (ключ задачи = доменный id + версия), с ретраями и backoff; финальный провал —
  видимое состояние, а не тишина.
- Доменные события между модулями — через outbox-коллекцию в той же транзакции.
- Конфиг — через `config/env.ts` (zod-валидация env при старте). `process.env` вне него — нельзя.
- Логи — структурные (pino), без персональных данных и токенов.
- Время — UTC в БД, часовой пояс пользователя — только на отображении.

## Проверка

`pnpm --filter @pokatim/api test`, затем `pnpm check`. Интеграционные тесты репозиториев — на
реальном MongoDB (replica set) и Redis (`pnpm infra:up`, стенд `@rkarakulov/test-kit/mongo`), не на моках.
