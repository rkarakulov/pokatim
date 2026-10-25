# pokatim: стек, архитектура, AI-база (предложение)

Статус: черновик для обсуждения, 2026-10-22. Документ исторический: **БД заменена — MongoDB вместо PostgreSQL +
PostGIS, [ADR-0007](adr/0007-mongodb.md)**.
Источники: инвесторская презентация, 19 прототипов, смета поддержки; анализ репозиториев webtrader, intera-app, AI-copilot-tri.

## 1. Что говорит спецификация (и что это меняет)

Стек в презентации/смете уже зафиксирован архитектурным документом проекта (на него ссылаются как на «архитектурный спайн, 28 инвариантов»):
Node 24 + NestJS (модульный монолит), Expo (iOS+Android), Vite + React (веб-панель), PostgreSQL 18 + PostGIS, Redis + BullMQ, Drizzle ORM, Docker Compose на одной VPS (hoster.by), Caddy, S3-совместимое хранилище.

Из прототипов — ключевые ограничения MVP:

- **Приложение не пишет GPS.** Заезд записывается часами/велокомпьютером, загружается файлом (FIT/GPX/TCX). Вся тяжёлая логика — на сервере: парсинг, проверка коридора (PostGIS), кластеры, флаги правдоподобия, пересчёты.
- **Нет push, WebSocket, BLE, Strava/Garmin API, гео-фенсинга.** Уведомления — только in-app центр (TTL 90 дней). Статусы обработки — polling.
- **Серверный авторитет результатов + append-only аудит** (споры, исключения, пересчёты, `RaceResultRevised`).
- **Карточки для шеринга** 1080×1920 (Skia, видео до 15 с через ffmpeg) и OG-картинки 1200×630 — серверный рендер в очереди.
- **Гостевой лендинг** по ссылкам 5 типов + публичная страница удаления аккаунта (требование Google Play). Нужен серверный HTML для OG-превью в мессенджерах.
- **Веб-панель** — плотный десктоп-инструмент (1440, только светлая тема «Протокол»): таблицы результатов, чек-лист публикации, разбор споров с графиками HR/мощности, модерация, сезоны.

Итого «4 платформы» по факту: **iOS + Android (одна Expo-база), веб-панель (desktop), гостевой веб (mobile web)** + API/воркер.

## 2. Стек: сравнение с исходной идеей

| Слой | Исходная идея | Предложение | Почему |
|---|---|---|---|
| Язык | TypeScript | TypeScript (strict) везде | — |
| Mobile | React Native | **Expo SDK (актуальный) + Expo Router** | EAS-сборки заложены в смету; Router даёт deep/universal links из коробки (5 типов ссылок) |
| Web | React | **Vite + React** (панель) + отдельный **SSR-лендинг** | UI панели и мобилки не пересекаются; лендингу нужен SSR ради OG-мета |
| Backend | Node.js | **NestJS, модульный монолит**: процесс `api` + процесс `worker` из одного кода | так в спецификации; воркер изолирует ffmpeg/Skia/гео от API |
| БД | Postgres | **PostgreSQL 18 + PostGIS**, Drizzle ORM, миграции drizzle-kit | коридор, расстояния, «рядом» — PostGIS; ST_* через `sql` |
| Кэш/очереди | Redis + RabbitMQ | **Redis + BullMQ, без RabbitMQ** | см. ниже |
| Контракты | — | **zod-схемы в `packages/contracts`** → OpenAPI → сгенерированный клиент + TanStack Query | одна правда для API, мобилки и панели; версия API для установленных приложений |
| Состояние на клиенте | — | TanStack Query (серверное) + zustand (локальное, минимум) | без Redux/thunks (боль webtrader) |
| Формы | — | react-hook-form + zod (те же схемы) | — |
| Карты | — | MapLibre (RN + GL JS), PMTiles в S3 или MapTiler | из сметы |
| Загрузка файлов | — | resumable upload (tus: `@tus/server` + `tus-js-client`) → S3 | прототип требует паузу/продолжение/отмену |
| Auth | — | свой email+пароль в NestJS (argon2, refresh-токены, rate-limit в Redis) | никаких внешних IdP; универсальные ссылки для verify/reset |
| Наблюдаемость | — | Sentry (API + mobile + web), pino-логи | из сметы |
| Тесты | — | Vitest (пакеты, web), Jest (Expo), Testcontainers (PG+PostGIS) для API, Playwright (web), Maestro (mobile e2e, позже) | — |

### RabbitMQ: не брать

- Один процесс-монолит + один воркер на одной VPS: брокер сообщений между сервисами не нужен — сервисов нет.
- BullMQ уже даёт ретраи, backoff, отложенные задачи, приоритеты, dead-letter (в прототипе «failed check → только Exclude track»), и он в смете.
- Минус один stateful-компонент на дежурство одного человека.
- Путь на будущее: доменные события пишем через **transactional outbox** в Postgres → публикатор кладёт в BullMQ. Если появится второй сервис — меняем транспорт на RMQ без переписывания модулей.

## 3. Монорепо: да

Аргументы:
1. **Общие контракты** между API и двумя-тремя клиентами — главный выигрыш: изменение DTO ломает typecheck во всех потребителях в одном PR.
2. **Атомарные изменения** фичи «бэк + мобилка + панель» одним коммитом.
3. **AI-разработка**: агент видит всю систему, один AGENTS.md, одни гейты `pnpm check`.
4. Соло-разработка: один CI, одна версия зависимостей (pnpm catalog).

Инструменты: **pnpm workspaces + Turborepo** (а не Nx).
Nx в webtrader — 358 проектов, boundaries без тегов, кастомный Metro-резолвер с прекомпиляцией в `build/`; для одного разработчика это оверхед. Turborepo даёт кеш и граф задач, границы — dependency-cruiser.
Expo с SDK 52+ сам настраивает Metro под монорепо; при проблемах с изолированными зависимостями — `nodeLinker: hoisted` в `pnpm-workspace.yaml`.

### Структура

```
pokatim/
├─ apps/
│  ├─ mobile/          Expo + Expo Router (iOS, Android)
│  ├─ admin/           Vite + React — панель организаторов/модерации
│  ├─ landing/         SSR гостевые страницы, удаление аккаунта, OG-мета
│  └─ api/             NestJS: src/main.ts (HTTP) + src/worker.ts (BullMQ)
│     └─ src/modules/  identity, profile, routes, rides, calendar, races,
│                      results, disputes, seasons, gamification, sharing,
│                      notifications, moderation, media
├─ packages/
│  ├─ contracts/       zod-схемы, enum-ы, коды ошибок, версии API
│  ├─ api-client/      сгенерированный клиент + TanStack Query hooks
│  ├─ tracks/          парсинг GPX/TCX/FIT/KML, геометрия (общий код pre-check и сервера)
│  ├─ design-tokens/   Jersey Aura / Night Ride / «Протокол»: цвета, типографика, отступы
│  ├─ i18n/            русские строки (формальное «вы»)
│  └─ config/          tsconfig, eslint (flat), prettier пресеты
├─ infra/              docker-compose (prod/stage/dev), Caddyfile, бэкап в S3
├─ docs/               product (PRD, epics), architecture, adr, tasks, runbooks
├─ tools/ai_review/    контракт ревью + codex-скрипты
└─ .claude/ AGENTS.md CLAUDE.md
```

Правила (из уроков webtrader):
- Модули NestJS — папки внутри `apps/api`, **не отдельные пакеты**. Пакет выделяется, только когда его импортируют ≥2 приложения.
- Модуль импортирует другой только через его публичный `index.ts` (dependency-cruiser, ratchet: error-правила = 0 нарушений). Модерация — в каждом модуле свой запрос, без сквозного сервиса (AD-1 из прототипов).
- Шаринг React ↔ RN — **на уровне контрактов, hooks, токенов, i18n, чистой логики**, не UI. react-native-web-подход webtrader здесь не окупается: UI панели и мобилки — разные продукты.
- Платформенные развилки внутри общих пакетов — суффиксы `.native.ts` / `.web.ts` (как в webtrader), но ожидаем их мало.
- Версии в одном месте (pnpm catalog), никаких смешанных мажоров.
- Миграции — отдельный шаг деплоя, не при старте сервиса.
- Секреты — никогда в git: gitignore-маски + gitleaks в pre-commit и CI с первого дня.

### Лендинг: варианты

| Вариант | Плюсы | Минусы |
|---|---|---|
| **A. Astro (SSR, node-адаптер)** — рекомендую | минимум JS, быстрый на мобильном, удобно делать OG-мета и HTML-письма | ещё один фреймворк |
| B. Рендер из NestJS (шаблоны/React SSR) | ноль новых процессов | смешивает API и вёрстку |
| C. Expo Router web | одна кодовая база с мобилкой | тяжело для гостевой страницы, OG-мета на динамике сложнее |

## 4. AI-база: что переносим

### Брать (почти как есть)

| Что | Откуда | Примечание |
|---|---|---|
| AGENTS.md — канон для всех агентов + тонкий CLAUDE.md-указатель | webtrader | держать ≤200 строк, детали — в rules |
| `.claude/rules/*.md` с path-scope (backend, mobile, web, db, security, tests) | webtrader | содержание пишем под pokatim |
| `.claude/settings.json`: allow/deny (запрет force-push, rebase, `rm -rf`, DROP, merge) | webtrader | коммитится в git |
| `/develop-task` + уровни task1/2/3 | intera-app (+ AI-copilot-tri) | UNDERSTAND → SPEC → PLAN → TDD → VERIFY → независимое ревью → FIX → DONE |
| `/create-spec`, `/plan-task`, `/verify-task`, `/review-task`, `/finish-task`, `/understand-project` | AI-copilot-tri | убрать бот/Mongo/ветки интеграции |
| Агенты `architect`, `coder`, `independent-reviewer` (model: inherit), `investigator` | intera-app, AI-copilot-tri, webtrader | ревьюер — свежий контекст, только findings |
| `tools/ai_review/review_contract.md` + `codex_review.sh` | AI-copilot-tri | кросс-движковое ревью Claude ↔ Codex |
| `task-template.md` (Goal / Scope / Out of scope / Placement & Reuse gate / Acceptance / Docs impact / Outcome) | intera-app | — |
| Stop-хук completion gate (advisory) | AI-copilot-tri | переписать под TS: `console.log`, пустой `catch`, `any`, строки UI вне i18n |
| pre-push `pnpm check` + установка хуков через `prepare` | intera-app | — |
| CI с path-filter по пакетам | AI-copilot-tri | под GitHub Actions или GitLab CI |
| dependency-cruiser с ratchet | intera-app | правила под apps/packages/modules |
| ADR / runbooks / docs-layout, `docs:check` путей из AGENTS.md | webtrader, AI-copilot-tri | — |

### Переписать под стек

- Скилы `backend-nest` (+ Drizzle, PostGIS, BullMQ, outbox, append-only аудит), `web-ui` (панель «Протокол»), **новый** `mobile-expo` (Expo Router, MapLibre, deep links, a11y, reduce motion).
- `/architecture-review` + шаблон debt-register — подключить, когда появится кодовая база.
- `ux-review` + Playwright-харнесс — для веб-панели и лендинга, когда будут экраны.

### Не брать

- Авто-bump версии на каждый коммит, генераторы-копировщики контрактов (заменяет `packages/contracts`), правило «всегда дописывать CHANGELOG / implementation-state» (у intera CHANGELOG 3,8 МБ).
- AI-конфиг в `.gitignore` (у intera почти всё вне git) — в новом репо **всё коммитим**.
- Pair-MR оркестратор, product-intel, wt-knowledge, ai-orchestrator — тяжело и завязано на Jira/GitLab/Telegram.
- Захардкоженные model ID в агентах.
- Зеркалирование в `.cursor/` — только если реально используешь Cursor.

Зависимость: workflow опирается на плагин **superpowers** (brainstorming, TDD, verification, receiving-code-review) — фиксируем это в AGENTS.md.

## 5. Открытые вопросы

1. Где PRD, архитектурный спайн (28 инвариантов), `epics.md` (51 стори)? Их нужно положить в `docs/product` и `docs/architecture` — это главный контекст для агентов.
2. Хостинг git и CI: GitHub или GitLab?
3. Используешь ли Codex / Cursor параллельно с Claude Code (нужны ли адаптеры `.agents/`, `.codex/`)?
4. Лендинг: Astro (A) или рендер из NestJS (B)?
5. Конфликт из прототипов: AD-28 (не выдавать токены неподтверждённым) vs registration-token flow (V-09).
