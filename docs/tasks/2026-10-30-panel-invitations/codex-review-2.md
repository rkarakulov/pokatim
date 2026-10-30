# Findings — panel-invitations — pass 2 — reviewer: codex
base: origin/develop   commits: 001153f6..ea2edf38
verdict: APPROVE

### [MEDIUM] `PANEL_LINK_BASE` не передаётся в контейнеры стенда
- **file:** docs/runbooks/deploy.md
- **location:** 136–138; infra/deploy/docker-compose.yml:12–36, 188, 211
- **problem:** Runbook предлагает задать `PANEL_LINK_BASE`, если панель размещена по другому адресу, однако конфигурация деплоя не передаёт эту переменную в API и worker.
- **why_it_matters:** После добавления переменной в `.env` сервера и пересоздания контейнеров письма продолжат использовать `${APP_WEB_ORIGIN}/admin/`. При отдельном адресе панели приглашённые получат ссылки на неверный адрес.
- **evidence:** API и worker используют `environment: *api-env`. В `x-api-env` передаётся `APP_WEB_ORIGIN: ${WEB_ORIGIN:?}`, но `PANEL_LINK_BASE` отсутствует; `env_file` у этих сервисов нет. Передача `.env` через `--env-file` обеспечивает подстановку Compose, но не экспортирует все переменные в контейнеры.
- **recommended_fix:** Добавить `PANEL_LINK_BASE: ${PANEL_LINK_BASE:-}` в общий `x-api-env`. Проверить конфигурацию Compose с заданным значением: переменная должна присутствовать у API и worker.

Замечания первого прохода устранены в коде: проверка текущего HMAC, состояние мутации отзыва, контекстные ошибки и `pr.md`. Новых CRITICAL/HIGH не найдено.

Проверены транзакции и гонки, авторизация, контракты и потребители, аудит, миграция, обработчики очереди, ошибки, тесты, i18n, документация, дизайн-система и состояния UI. Изменений приложения райдера, требующих реализации для iOS/Android/web, нет.

`git diff --check origin/develop...HEAD` — успешно.

**NOT VERIFIED:** тесты и `pnpm check` независимо не запускались в окружении только для чтения. Зелёный результат в `task.md` — отчёт implementer, независимо не подтверждён.