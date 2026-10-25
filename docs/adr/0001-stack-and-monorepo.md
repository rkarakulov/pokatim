# 0001. Стек и монорепо

- Статус: Accepted; частично заменён [ADR-0003](0003-universal-rider-app.md) — гостевой веб (`apps/landing`, Astro)
  удалён в F5b, веб — то же Expo-приложение; и [ADR-0007](0007-mongodb.md) — данные (MongoDB вместо PostgreSQL + PostGIS)
- Дата: 2026-10-22

## Контекст

- Платформы: iOS + Android, веб-панель организаторов (desktop), гостевые веб-страницы (mobile web), API.
- Соло-разработка, одна VPS (hoster.by), бюджет на хостинг 187 → 419 BYN/мес.
- Приложение не пишет GPS: заезды загружаются файлами, вся обработка (разбор, коридор, кластеры,
  пересчёты, рендер карточек) — на сервере. Push и WebSocket в MVP нет.
- Архитектурный спайн проекта уже фиксирует NestJS-монолит, Expo, Vite + React, PostgreSQL 18 + PostGIS,
  Redis + BullMQ, Drizzle, Docker Compose. Подробности — `docs/proposal-stack-architecture.md`.

## Решение

- **Монорепо: pnpm workspaces + Turborepo.** Версии зависимостей — в pnpm catalog.
- **TypeScript strict** везде; цель — Node 24.
- **apps/api** — NestJS, модульный монолит; два процесса из одного кода: `main.ts` (HTTP) и `worker.ts` (BullMQ).
- **apps/mobile** — Expo SDK 58 + Expo Router (deep / universal links, CNG без коммита `ios/`/`android/`).
- **apps/admin** — Vite + React; TanStack Query / Table, react-hook-form.
- **apps/landing** — Astro SSR (гостевые страницы, OG-мета, публичное удаление аккаунта). *Заменено ADR-0003:
  гостевой веб — из универсального Expo-приложения.*
- **Данные** — PostgreSQL 18 + PostGIS через Drizzle; миграции drizzle-kit отдельным шагом деплоя. *Заменено
  ADR-0007: MongoDB 8.0 (replica set), миграции — `db:migrate` отдельным шагом деплоя.*
- **Очереди** — Redis + BullMQ. **RabbitMQ не используем**; события между модулями — transactional outbox.
- **Контракты** — zod-схемы в `packages/contracts`; клиенты — через `packages/api-client`.
- Общий код клиентов — контракты, hooks, токены, i18n, чистая логика. **UI между web и mobile не шарим**
  (react-native-web не используем).

## Альтернативы

- **Nx** — мощнее (теги, генераторы), но для одного разработчика оверхед; опыт webtrader: 358 проектов,
  boundaries без тегов, хрупкий Metro-резолвер.
- **RabbitMQ** — нужен при нескольких сервисах/языках; у нас один монолит, BullMQ закрывает ретраи,
  отложенные задачи и dead-letter, а это минус один stateful-компонент на дежурство.
- **react-native-web, один UI на все платформы** — панель «Протокол» и мобильное приложение — разные продукты.
- **Лендинг на Expo Router web или из NestJS** — тяжелее для гостевой страницы либо смешивает API и вёрстку.

## Последствия

- Изменение схемы в contracts ломает typecheck всех потребителей в одном PR — это цель.
- Expo в pnpm-монорепо: при проблемах изолированных зависимостей — `nodeLinker: hoisted`.
- Переход на RabbitMQ возможен заменой транспорта outbox-публикатора, без переписывания модулей.
- Пересмотреть при появлении второго сервиса, push/realtime или выхода за одну VPS.
