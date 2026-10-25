# pokatim

Платформа для велосипедистов Беларуси: гонки по GPS-коридору, кофе-райды, маршруты, календарь стартов.

Монорепо: `apps/api` (NestJS + воркер BullMQ), `apps/admin` (Vite + React),
`apps/app` (Expo: iOS, Android и web/PWA с SSR), общие `packages/*`. Правила для людей и агентов — [AGENTS.md](AGENTS.md),
решения — [docs/adr](docs/adr/README.md), обоснование стека — [docs/proposal-stack-architecture.md](docs/proposal-stack-architecture.md).

## Быстрый старт

Нужны pnpm 11, Docker и доступ к пакетам `@rkarakulov/*` (runbook, шаг 0). Node 24 pnpm скачает сам
(`devEngines.runtime`). Dev-образ MongoDB мультиархитектурный — работает и на Apple Silicon.

```bash
export NODE_AUTH_TOKEN=$(gh auth token)
pnpm install
pnpm infra:up                           # MongoDB 8.0 (replica set), Redis, Mailpit
cp apps/api/.env.example apps/api/.env  # и заполнить секреты (runbook, шаг 2)
pnpm --filter @pokatim/api db:migrate
pnpm dev                                # все приложения
```

| Приложение | Команда | Адрес |
| --- | --- | --- |
| API | `pnpm dev --filter=@pokatim/api` | http://127.0.0.1:3000/v1/health |
| Воркер (письма, очереди) | `pnpm dev:worker` | — |
| Панель «Протокол» | `pnpm dev --filter=@pokatim/admin` | http://127.0.0.1:5173 |
| Приложение | `pnpm --filter @pokatim/app dev` | QR → Expo Go, `i` / `a` — симуляторы, `w` — браузер (http://127.0.0.1:8081) |
| Web (production) | `cp apps/app/.env.example apps/app/.env` → `pnpm build:web` → `pnpm --filter @pokatim/app start:web` | http://127.0.0.1:8080 |

Запускайте API и воркер через `pnpm dev` / `pnpm dev:worker` (turbo): они сначала собирают `packages/*`, которые
API берёт из `dist`. Web открывайте на `127.0.0.1`, не `localhost`: cookie сессии web привязана к сайту API
(runbook, «Web»).

## Проверки

`pnpm check` — формат, lint, границы архитектуры, typecheck, тесты. Запускается в pre-push и в CI.
`pnpm e2e:web` — смоук web в браузере (Playwright); `E2E_API=1 pnpm e2e:web` — с регистрацией через API и Mailpit
(runbook, «Web»).

## Шаблон app-foundation

pokatim — проект шаблона [app-foundation](https://github.com/rkarakulov/app-foundation) (ADR-0004): версия и
ответы — `.copier-answers.yml`, обновление каркаса (CI, конфиги, AI-инфраструктура) — `uvx copier update --defaults`
(подробно — [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md)). Процесс разработки для Claude Code — плагин
`app-dev-kit` (предлагается при открытии проекта, `.claude/settings.json`), для Codex — `.agents/skills` и `.ai/dev-kit`.

## Сборки приложения (EAS)

Один раз: аккаунт Expo (`npx eas-cli login`), затем `npx eas-cli init` в `apps/app`.

- `pnpm --filter @pokatim/app build:preview` — APK для Android и ad-hoc для iOS (нужен Apple Developer и UDID устройств).
- `pnpm --filter @pokatim/app build:testflight` — TestFlight (Apple Developer + запись в App Store Connect).
- `pnpm --filter @pokatim/app build:play-internal` — Google Play, внутреннее тестирование (Play Console).
