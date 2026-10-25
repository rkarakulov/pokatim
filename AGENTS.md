# AGENTS.md — канон для всех агентов pokatim

Единственный источник правил для Claude Code, Codex и любого другого агента.
`CLAUDE.md` — тонкий указатель сюда. Детали по зонам — в `.claude/rules/*.md`.
Процесс разработки (команды, агенты, скилы) поставляет плагин `app-dev-kit` базы app-foundation;
нумерацию разделов ниже он использует — не меняйте её.

## 0. Порядок приоритетов

1. Явная инструкция человека в текущей сессии.
2. Этот файл (инварианты, safety, completion gate).
3. `.claude/rules/<зона>.md` для затронутых путей.
4. Принятые ADR в `docs/adr/`.
5. Продуктовые документы `docs/product/` (PRD, epics, архитектурный спайн).
6. Существующий код и его конвенции.

Конфликт между уровнями — остановись и вынеси человеку с рекомендацией; не выбирай молча.

## 1. Проект кратко

«Покатим» (pokatim) — геймифицированная платформа для велосипедистов Беларуси: гонки по GPS-коридору,
кофе-райды, библиотека маршрутов, календарь стартов, единый профиль райдера.
Аудитория — только Беларусь, UI полностью на русском, формальное «вы».

Ключевые продуктовые рамки MVP (из прототипов):

- приложение **не записывает GPS** — заезд загружается файлом (FIT/GPX/TCX) с часов/велокомпьютера;
- **нет push, WebSocket, BLE, Strava/Garmin API** — уведомления только in-app, статусы — polling;
- результаты гонок считает **только сервер**; клиент никогда не диктует итог;
- модерация — по жалобам, своя очередь в каждом модуле (без сквозного сервиса).

## 2. Структура репозитория

```
apps/
  api/        NestJS (Fastify): src/main.ts (HTTP) + src/worker.ts (BullMQ); модули в src/modules/<context>
  app/        Expo + Expo Router — универсальное приложение райдера (iOS, Android, web/PWA с SSR; server/ — web-сервер)
  admin/      Vite + React — веб-панель организаторов «Протокол» (desktop, только светлая тема)
packages/
  contracts/     zod-схемы — источник правды API (DTO, enum-ы, коды ошибок)
  api-client/    тонкий HTTP-клиент поверх contracts (zod-валидация ответов)
  tracks/        парсинг GPX/TCX/FIT/KML, геометрия
  design-tokens/ бренд: Jersey Aura / Night Ride / «Протокол» (тема panel) поверх @rkarakulov/design-tokens
  i18n/          русские строки поверх словарей @rkarakulov/i18n-core
infra/        docker-compose (dev — из шаблона; prod), Caddy
docs/         product, architecture, adr, tasks, runbooks
tools/ai_review/  контракт независимого ревью + Codex-мосты
.ai/dev-kit/  копия текстов плагина app-dev-kit для Codex (не править)
```

Имена пакетов — `@pokatim/<name>`. Node 24 (`.nvmrc`), pnpm 11, Turborepo.

Общий код — пакеты базы `@rkarakulov/*` (репозиторий `rkarakulov/app-foundation`, ADR-0004,
GitHub Packages): компоненты дизайн-системы `@rkarakulov/ui`, инфраструктура API `@rkarakulov/api-kit` (env, БД,
outbox, очереди, лимитер, почта, HTTP, ошибки), тестовый стенд `@rkarakulov/test-kit`, ядра `design-tokens`,
`i18n-core`, `contracts-core`, `api-client-core`, пресеты `@rkarakulov/config`. В проекте — бренд, домен, тексты и
композиция. Изменение общего кода — задача и релиз в app-foundation, не копия в проекте.
БД — MongoDB: из пакетов API — только входы `@rkarakulov/api-kit/core`, `@rkarakulov/api-kit/mongo`,
`@rkarakulov/test-kit/core`, `@rkarakulov/test-kit/mongo` (корни пакетов — PostgreSQL, импорт запрещён ESLint).

Шаблон: `.copier-answers.yml` — ответы и версия шаблона. `.ai/dev-kit/`, `.agents/skills/`, `.codex/agents/`
генерирует база — руками не правятся, обновляются `copier update`.

## 3. Команды

| Команда | Что делает |
|---|---|
| `pnpm install` | установка зависимостей (нужен `NODE_AUTH_TOKEN`, `docs/runbooks/local-dev.md`) |
| `pnpm dev` | все приложения в dev через turbo (сначала собирает `packages/*`) |
| `pnpm dev --filter=@pokatim/<app>` | одно приложение в dev (api / admin) |
| `pnpm --filter @pokatim/app dev` | приложение Expo (Expo Go, симуляторы) |
| `pnpm dev:worker` | воркер очередей BullMQ в dev |
| `pnpm build` | production-сборка |
| `pnpm --filter @pokatim/app build:preview` | EAS: сборки для внутренних тестеров |
| `pnpm build:web` | web-сборка приложения: SSR + PWA (`apps/app/dist`, service worker) |
| `pnpm --filter @pokatim/app start:web` | production web-сервер на `dist` (env — `docs/runbooks/local-dev.md`, «Web») |
| `pnpm e2e:web` | Playwright-смоук web в браузере (сначала `build:web`; нужен Chrome или `PW_CHANNEL`); с API — `E2E_API=1` (регистрация → письмо → вход, runbook «Web») |
| `pnpm infra:up` / `pnpm infra:down` | docker compose: MongoDB 8.0 (replica set), Redis, Mailpit |
| `pnpm check` | **completion gate**: format:check + lint + arch:check + typecheck + test |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | по отдельности |
| `pnpm format` | prettier --write |
| `pnpm arch:check` | dependency-cruiser |
| `pnpm --filter @pokatim/api db:migrate` | применить миграции MongoDB (`apps/api/src/db/migrations`) |
| `pnpm --filter @pokatim/<pkg> <script>` | скрипт одного пакета |
| `uvx copier update --defaults` | обновить проект до новой версии шаблона app-foundation |

Не выдумывай команды. Нет скрипта — так и напиши.

## 4. Архитектурные инварианты

1. **Серверный авторитет.** Итоговые и вычисляемые значения (статусы, суммы, рейтинги, права) считает и
   проверяет только сервер. Клиент присылает намерение, а не результат. В pokatim: трек валидируется и
   пересчитывается только на сервере; клиент отправляет файл, но не время, место или кластер.
2. **Contracts-first.** Любое изменение API начинается со схемы в `packages/contracts`.
   NestJS валидирует по ней, клиенты потребляют её же. Ручные копии DTO запрещены.
3. **Границы модулей.** Модуль `apps/api/src/modules/<a>` импортирует `<b>` только через
   `modules/<b>/index.ts`. Приложения не импортируют друг друга. `packages/*` не импортируют `apps/*`.
   Проверяется `pnpm arch:check`.
4. **Пакет выделяется,** только когда его используют ≥2 приложения. Модули API — папки, не пакеты.
   Общий для проектов код — в app-foundation, не в проекте.
5. **Очереди.** Тяжёлое и асинхронное — задачи BullMQ в `worker`. Задачи идемпотентны.
   Доменные события между модулями — через transactional outbox в MongoDB (коллекция `outbox` в той же
   транзакции).
6. **Миграции** — отдельный шаг деплоя, никогда при старте сервиса. Деструктивные — только с человеком.
7. **Время** храним в UTC, показываем в Europe/Minsk.
8. **Секреты** никогда не попадают в git, логи, task.md и ответы. Только `.env*` вне git и переменные окружения.
9. **Нет «на вырост».** Не добавляй возможности, внешние сервисы и абстракции вне рамок §1 без ADR
   (push, WebSocket, GPS-запись, внешние IdP и т.п.).
10. **Append-only аудит** — если проект его ведёт: история решений и чувствительных действий только
    вставкой новых записей; UPDATE/DELETE истории запрещены. pokatim ведёт: споры, исключения/восстановления
    треков, пересчёты, решения модерации.
11. **Всё UI — из дизайн-системы.** Любой экран, страница и элемент собирается из `@pokatim/design-tokens`
    (семантические роли, `.t-*` / `textStyle`, `space` / `inset` / `size` / `stroke` / `density`) и готовых
    компонентов (`@rkarakulov/ui`; веб — классы и переменные пакета). Нужного нет — **расширяй систему**:
    общий компонент или токен — задачей и релизом в app-foundation (с тестом и примером на витрине `UiKit`);
    продуктовый компонент — в `apps/app/src/components` только из токенов и компонентов системы, с тестом.
    Запрещено: hex и примитивы `color.*` в приложениях (ловит ESLint), px-литералы оформления (размеры,
    отступы, шрифты, толщины), свои шрифты и цвета «по месту». Разрешено без токенов только раскладка:
    flex/grid, порядок, выравнивание, проценты, `0`. Значения берутся из прототипов; расходятся с ними —
    вопрос человеку.
12. **Загрузка — скелетон, не спиннер.** Каждый экран и блок с асинхронными данными:
    - **первая загрузка** — скелетон, повторяющий раскладку успешного состояния (приложение — `AsyncContent`
      + `Skeleton*`, веб — `.skeleton`); спиннеры и пустой экран вместо контента запрещены везде;
    - **сразу видны** заголовок, навигация и фильтры — скелетон только на месте данных;
    - **ошибка без данных** — сетевая: «Нет соединения», ответ сервера: «Не удалось загрузить»; всегда с повтором;
    - **ошибка обновления при уже показанных данных** — данные остаются, сверху баннер с повтором;
    - **пусто** — пустое состояние экрана;
    - **мутации** — состояние кнопки (disabled на время запроса, индикатор внутри кнопки допустим), не скелетон.
13. **Все платформы (ADR-0003).** Фича = все платформы: экран приложения работает в iOS, Android и web/PWA
    (мобильный и десктопный браузер) с тем же функционалом. Платформенные развилки — только файлами рядом
    (`*.web.ts(x)` / `*.native.ts(x)`, бандлер выбирает сам); экраны и компоненты о платформе не знают
    (`Platform.OS` в экранах — нет). Публичные экраны (открываются по ссылке без входа) рендерятся на сервере:
    мета и OG — `generateMetadata`, `loader` — только ускоритель SSR (посев запроса через `useLoaderSeed`);
    источник данных на всех платформах — API (TanStack Query). Нет web-варианта — дефект, как и нет iOS/Android.

## 5. Workflow

Точка входа — `/app-dev-kit:develop-task <задача>` (в Codex — `$develop-task`). Он выбирает уровень:

| Уровень | Когда | Команда |
|---|---|---|
| 1 | механическая правка, без смены поведения | `/app-dev-kit:task1` |
| 2 | понятная задача, нужен план | `/app-dev-kit:task2` — plan → task.md → inline → reviewer |
| 3 | несколько модулей, миграции, контракты, безопасность | `/app-dev-kit:task3` — architect → coder → reviewer |

Артефакты задачи: `docs/tasks/<YYYY-MM-DD>-<slug>/{task.md,findings.md,pr.md}` — коммитятся.
Шаблон task.md — в плагине (`templates/task-template.md`; для Codex — `.ai/dev-kit/templates/`).
Независимое ревью — `tools/ai_review/review_contract.md`.

Requirements Sanity Check обязателен: противоречия в требованиях, конфликт с инвариантами,
недоопределённость, вредные решения — выносить человеку прямо, с 2–3 альтернативами и рекомендацией.

Зависимость: плагин **superpowers** (brainstorming, writing-plans, test-driven-development,
systematic-debugging, verification-before-completion, receiving-code-review,
finishing-a-development-branch). Если его нет — выполни ту же фазу вручную, фазу не пропускай.

## 6. Completion gate

- Задача не «готова» без фактического вывода `pnpm check` (зелёного) в отчёте.
- Если проверка не запускалась или упала по внешней причине — пиши `NOT VERIFIED` + причина.
- Новое поведение — с тестами. Багфикс — сначала падающий тест.
- Независимое ревью без нерешённых CRITICAL/HIGH.
- Изменения миграций / env / конфигов явно описаны в `pr.md`.

## 7. Git и safety

- GitHub. Ветки `feature/<slug>`, `fix/<slug>`; `main` защищён.
- Коммит в рабочую ветку и draft-PR через `gh` — можно. **Push и merge — только с явного «да» человека.**
- Запрещено без человека: `git push --force`, `git rebase`, `git reset --hard`, merge PR,
  деплой, деструктивные миграции, удаление данных, смена секретов и инфраструктуры.
- `git add` — по конкретным путям, не `-A`.
- Стоп и вопрос человеку: требование противоречит инварианту §4; нужен новый внешний сервис;
  задача выросла за scope; проверка красная по непонятной причине.

## 8. Индекс правил

| Файл | Зона |
|---|---|
| `.claude/rules/backend.md` | `apps/api/**` |
| `.claude/rules/db.md` | миграции, коллекции и индексы MongoDB |
| `.claude/rules/contracts.md` | `packages/contracts/**`, `packages/api-client/**` |
| `.claude/rules/app.md` | `apps/app/**` |
| `.claude/rules/web.md` | `apps/admin/**` |
| `.claude/rules/tests.md` | все тесты |
| `.claude/rules/security.md` | конфиг и инфраструктура API, CI, реестр пакетов, секреты |
| `.claude/rules/pokatim-*.md` | домен pokatim поверх правил шаблона: `pokatim-backend`, `pokatim-db`, `pokatim-contracts`, `pokatim-app`, `pokatim-web` (admin), `pokatim-security` (identity, media, удаление аккаунта), `pokatim-tests` |

Команды, агенты и скилы зон (`backend-nest`, `mobile-expo`, `web-ui`) — плагин `app-dev-kit`
(`.claude/settings.json`). Codex: адаптеры `.agents/skills/`, роли `.codex/agents/`, тексты — `.ai/dev-kit/`;
соответствие Claude ↔ Codex — `.ai/dev-kit/docs/ai-runtime.md`.

## 9. Карта документации

- `docs/README.md` — индекс.
- `docs/product/` — PRD, epics, архитектурный спайн (источник продуктовых решений).
- `docs/architecture/` — текущая архитектура системы.
- `docs/adr/` — принятые решения (`README.md` — индекс; стек — `0001-stack-and-monorepo.md`, база — `0004-app-foundation.md`).
- `docs/tasks/` — артефакты задач.
- `docs/runbooks/` — эксплуатация (`local-dev.md`).

Читай 1–4 релевантных документа, не всю папку. Нет документа — не выдумывай содержимое, зафиксируй gap.

## 10. Формат финального ответа

Что сделано · какие файлы · какие проверки с результатом (или `NOT VERIFIED`) ·
итог ревью · что осталось открытым. Коротко, по-русски.
