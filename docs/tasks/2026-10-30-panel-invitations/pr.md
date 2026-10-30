# panel-invitations — приглашения в команду панели и письма о роли

Задача: [task.md](task.md), ADR: [0026](../../adr/0026-panel-invitations.md). Ревью pass 1: [Claude](claude-review-1.md),
[Codex](codex-review-1.md) — замечания исправлены (ниже).

## Что сделано

- **Приглашение по e-mail** (`members.manage`): «Пригласить» в «Сотрудниках» — e-mail, имя в панели, роль; аккаунта
  может не быть. Письмо со ссылкой `<база панели>invite#token=…` (7 дней). Приглашённый регистрируется в приложении,
  подтверждает e-mail и на экране `/invite` принимает приглашение своим паролем — сразу вход (шаги 2FA ADR-0024).
- **Блок «Приглашения»** (`members.read`): «Истекло», «Письмо не отправлено», «Отправить повторно» (прежняя ссылка
  гаснет), «Отозвать» (подтверждение без причины, окно — до ответа сервера).
- **Принятие — шаг входа паролем** (`POST /v1/admin/invitations/accept`, `@Public`, IP-лимит 20/15 мин): снимок по
  `sha256(token)` и сверка с выводом из текущего секрета (иначе 410 до argon2) → `PanelCredentials.verify` → e-mail
  аккаунта = адрес → транзакция `lockAccountState` → `lockAdmins` → `lockPending` → `lockMember` → активация →
  `markAccepted` → журнал → `continueAfterCredentials`. Отдельного `lookup` нет.
- **Письма о роли**: выдача, смена, снятие (и CLI `grant-admin`) — outbox `panel.role-email-requested { auditId }` в
  транзакции действия, без причины, с кнопкой «Открыть панель».
- Журнал: `panel.invitation_sent|revoked|accepted`, объект `Приглашение ·<id>`; e-mail — не в журнале, outbox, логах.

## Деплой

- **Миграция `0041_panel_invitations`** (expand-only, идемпотентна): коллекция `panel_invitations`, индексы
  `panel_invitations_token_hash_unique`, `panel_invitations_pending_email_unique` (частичный, `status: 'pending'`),
  `panel_invitations_status_created_idx`, TTL `panel_invitations_purge_ttl`. Шаг `db:migrate` до выкладки API.
- **Новый env `PANEL_LINK_BASE`** (необязательный, `http(s)://…/` с «/» в конце; на prod-стенде — только https). Стенд и
  прод берут базу от `APP_WEB_ORIGIN` (`/admin/`) — менять `.env` не нужно; без обоих «Пригласить» — `503
  PANEL_INVITATIONS_UNAVAILABLE`. Локально — `http://localhost:5173/` (`apps/api/.env.example`).
- **Новая очередь `panel-email`** (worker, `PanelWorkerModule`): письмо-приглашение и письма о роли. Отдельной
  настройки не требует; worker должен быть выкачен вместе с API.
- CLI `grant-admin` теперь пишет outbox (только MongoDB, без Redis).
- Ротация `EMAIL_TOKEN_SECRET` гасит все выданные приглашения (и QR билетов, ссылки писем) — runbook «Деплой».

## Проверки

- Тесты-ворота гонок: `panel-invitations-locks.int.test.ts` — accept ↔ revoke, accept ↔ повторное приглашение (с
  отрицательным доказательством «без перепроверки статуса»), ворота внутри транзакции после `lockPending` (с
  отрицательным доказательством «без `$inc`»), два accept, два POST, accept admin ↔ понижение.
- `panel-invitations.int.test.ts`, `panel-email.int.test.ts`, `cli/panel-cli.int.test.ts`, миграции, unit, admin
  (`MembersScreen`, `InviteScreen`, `AuditScreen`) — task.md §12.
- `pnpm check` — результат в task.md §12.

## Follow-ups

- **Правила `.claude/rules/*` — нужен OK человека:** `pokatim-backend.md` («Новые `@Public()`» — `accept` приглашения,
  ADR-0026), `pokatim-security.md` («Панель» — приглашения: токен во фрагменте, HMAC от id, сверка с текущим
  секретом, IP-лимит, привязка к e-mail аккаунта), `pokatim-db.md` («Панель» — `panel_invitations`, `lockPending`,
  `email: null` после закрытия, TTL `purgeAt`).
- RC-13: снятие роли не удаляет `panel_totp` — повторно активированный получит шаг кода со старым приложением.
- e2e смоук `pnpm e2e:admin`: приглашение → письмо в Mailpit → `/admin/invite#token=…` → «Обзор» — не добавлен.
- «Запомненное устройство» на принятии не видно (cookie `Path=/v1/admin/session`, RC-4) — принято.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
