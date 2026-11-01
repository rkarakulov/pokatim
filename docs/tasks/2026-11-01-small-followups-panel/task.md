# task.md — small-followups-panel: имена в спорах и пересчётах панели, e2e 2FA

Уровень: task2. Два follow-up одного PR «панель»: `docs/product/profile.md` (Follow-up «Имя в спорах и истории
пересчётов панели») и `docs/tasks/2026-10-29-panel-2fa/task.md` §8.2 п.10 (сценарий подключения 2FA в смоуке).
Ветка `claude/small-followups-2-panel` от `develop`.

## 1. Title

Имя райдера (Q2) в спорах и истории пересчётов панели; Playwright-сценарий подключения 2FA и входа с кодом.

## 2. Goal

Сотрудник видит в списке и разборе спора и в «Истории пересчётов» то же имя, что «Участники» и «Попытки»: `Анна К. ·{id}`
при имени и согласии, иначе `Участник ·{id}`. Подключение 2FA панели и вход с кодом проверяются в браузере в CI.

## 3. Scope

1. **Контракты.** `PanelDisputeListItem.targetRiderName`, `PanelDispute.target.riderName`,
   `PanelDispute.complainant.riderName`, `PanelProtocolRecalculation.riderName` — обязательные `z.string().nullable()`
   (панель деплоится с API, `pokatim-contracts.md`).
2. **API.** `DisputesPanelService.list/get` — имена сторон одним `RIDER_NAMES.publicNames` на ответ (новое ребро
   `disputes → profile`: `ProfileCoreModule` через `modules/profile/index.ts`). `ResultsPanelReadService.recalculations`
   — `userId` заявок записей (`entryUsers`, проекция `_id` → `userId`) → один `publicNames`. Имя — только в ответе.
3. **Админка.** Цель в списке споров, цель и заявитель в разборе, участник в `RecalculationsList` —
   `riderLabel(entryId, riderName)` (`results-format.ts`); `disputeRiderLabel` и ключ `admin.disputes.rider` удалены.
4. **e2e 2FA.** `apps/admin/e2e/project.ts` — фиктивный `PANEL_TOTP_KEY` (hex 64) в окружении API смоука, без
   `PANEL_TOTP_ENFORCED`. `apps/admin/e2e/totp.spec.ts`: grant-admin → вход → «Безопасность» → «Подключить» → ключ со
   страницы → код TOTP считает тест (`node:crypto`, RFC 6238) → коды восстановления → «Выйти» → пароль + код → «Обзор».

## 4. Out of Scope

Имя в журнале действий и деталях аудита, имена в приложении (споры райдера), обязательная 2FA в смоуке, восстановление
кодом и «Запомнить устройство» в e2e.

## 8. Risks / Assumptions

- `[ASSUMPTION]` Ключ 2FA без `PANEL_TOTP_ENFORCED` не меняет прочие сценарии: вызов кода — только у сотрудника с
  активной 2FA (`PanelSessionService.continueAfterCredentials`), обязательность — только при флаге
  (`PanelTotpCodes.required`). Баннер «Подключите 2FA» на «Обзоре» от ключа не зависит.
- Повтор шага TOTP закрыт (`lastUsedStep`): при входе тест берёт код следующего шага (окно сервера ±1 шаг) — без
  ожидания 30 с.
- Импорт `apps/api/src/modules/panel/totp.ts` из e2e админки — ребро apps → apps; HOTP (10 строк) — прямо в тесте.

### 8.2 Решения

1. Ревью pass 1: в списке — только `targetRiderName` (UI показывает только цель; имя заявителя в списке — лишние ПДн),
   в разборе — только вложенные `target.riderName` / `complainant.riderName` (`PanelDispute` — строка списка
   `.omit({ targetRiderName })`). Поля — обязательные `nullable`, без `.default(null)`.
3. Ревью pass 1: `entriesByIds` — прежняя обязательная `session`; для пересчётов — `entryUsers` (`_id` → `userId`,
   проекция). Код входа в e2e — `max(текущий шаг, шаг подключения + 1)` прямо перед вводом.
2. Подпись — общий `riderLabel` (`admin.results.rider` / `riderNamed`) вместо своего `disputeRiderLabel`.

### 8.3 Security checklist

- Имя — только через порт `RIDER_NAMES.publicNames` (имя + `showNameInResults`), как у публики; в спор, историю спора,
  журнал пересчётов, `PanelAudit` и логи не пишется (int-тест: документы спора и записи пересчётов без имени).
- Права прежние: `disputes.read` / `races.read` для пересчётов; новых эндпоинтов нет.
- `PANEL_TOTP_KEY` смоука — явно фиктивный (`'e2e0'.repeat(16)`), только в `e2e/project.ts`. Секрет TOTP и коды
  восстановления тест не печатает: проверки без значений в сообщениях (`expect(len === 20).toBe(true)`).

## 9. Acceptance Criteria

1. Список и разбор спора: имя цели и заявителя при имени и согласии; имя без согласия и без профиля — `null`; ключи
   строки списка — явный набор (int).
2. История пересчётов: `riderName` записи с заявкой — по тому же правилу; публикация — `null`; ключи записи (int).
3. Админка: «Анна К. ·id» в списке споров, в разборе (цель, заявитель) и в истории пересчётов; без имени —
   «Участник ·id» (Vitest + RTL).
4. `pnpm arch:check` — без нарушений; правило `pokatim-backend.md` описывает ребро `disputes → profile`.
5. e2e `totp.spec.ts`: подключение → выход → вход с кодом → «Обзор»; прочие сценарии смоука без изменений.

## 10. Docs

`docs/product/profile.md` (Q2, «Где в продукте», Follow-up закрыт), `.claude/rules/pokatim-backend.md` (модули,
«Споры»), `.claude/rules/pokatim-web.md` («Споры», `RecalculationsList`).

## 12. Outcome

- Сделано: п. 1–4 Scope; e2e-сценарий и ключ смоука.
- Проверки: int API (`disputes/*`, `results-names`, `results-revisions`) — 6 файлов, 54 теста зелёные; админка
  `features/disputes`, `features/results` — 74 теста; `typecheck` api/admin, `eslint` по изменённым файлам,
  `prettier --check`, `pnpm arch:check` — зелёные.
- e2e локально (Chrome, Mailpit `brew`, API из `dist`, миграции на `pokatim_small2b_e2e`): все 5 сценариев
  `apps/admin/e2e` зелёные, включая `totp.spec.ts`, — с временным конфигом `expect.timeout` 30 с (load average машины
  20–30, с дефолтными 5 с ожидания не успевали; конфиг удалён).
- NOT VERIFIED: смоук с дефолтными таймаутами на этой машине; проверка — job `web` в CI (переменных хватает: ключ 2FA
  задаёт `project.ts`).
