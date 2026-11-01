# Findings — small-followups-panel — pass 1 — reviewer: claude
base: origin/develop (merge-base ff5d22cb)   commits: origin/develop..21972bdd (f6b5a6b4, 32a0d8ce, 21972bdd)
verdict: APPROVE

Проверено: утечки имени нет (порт `RIDER_NAMES.publicNames` → `findPublicNames`, имя + `showNameInResults`); имя
только в ответе — не попадает в `disputes`, `dispute_events`, outbox, `PanelAudit` (`disputes.decided` — `entryId`,
без имени), лог `disputes.decided` и `recalculations`. N+1 нет: список — один `publicNames` на страницу, разбор — один,
история пересчётов — `entriesByIds` + один `publicNames` (константно 2 запроса). Границы: `disputes` → `../profile`
(index.ts), `DisputesPanelService` живёт только в `DisputesModule` (не в `DisputesCoreModule`/worker), ребро
одностороннее (`profile` не импортирует `disputes`), правило dependency-cruiser «только через index.ts» соблюдено.
`PANEL_TOTP_KEY` без `PANEL_TOTP_ENFORCED` прочие сценарии не меняет: `required()` = `admin && PANEL_TOTP_ENFORCED`,
вызов кода — только при активной 2FA. RTL — `findBy*` без локальных `timeout`. `pnpm arch:check` и тесты не запускал
(по заданию) — NOT VERIFIED локально, полагаюсь на CI.

### [MEDIUM] Код повторного входа привязан к шагу подключения — флак при медленном прогоне
- **file:** apps/admin/e2e/totp.spec.ts
- **location:** 121–132 (`const enrolledStep = totpStep()` … `totpCode(secret, enrolledStep + 1)`)
- **problem:** код входа считается от шага, взятого до подтверждения подключения, а не от текущего времени. Сервер
  (`apps/api/src/modules/panel/totp.ts:86`, окно ±1 шаг) примет шаг `E+1` только если его текущий шаг ∈ {E, E+1, E+2}.
  Между вычислением `E` и отправкой кода входа — подтверждение, коды восстановления, «Готово», «Выйти», вход паролем
  (~10 ожиданий UI). Если прошло ≥ 60–90 с (в зависимости от фазы внутри шага), код вне окна → «Неверный код», тест
  падает.
- **why_it_matters:** сам task.md §12 фиксирует, что на машине автора с дефолтными 5 с ожидания сценарий не успевал
  (нужен был `expect.timeout` 30 с) — в таком режиме 60+ с между шагами реальны; в CI флак маскируется `retries: 1`.
- **evidence:** `await page.getByLabel('Код из приложения').fill(totpCode(secret, enrolledStep + 1));` при
  `lastUsedStep = E` (`panel.repository.ts:312`, `activateTotp` пишет принятый шаг).
- **recommended_fix:** на шаге входа брать `Math.max(enrolledStep + 1, totpStep())` (код текущего шага, но строго
  больше принятого); при желании — ждать границы шага, если до неё < 2 с.

### [LOW] Новые поля имени — `.default(null)` вопреки правилу «панель — обязательные nullable»; правило контрактов не обновлено
- **file:** packages/contracts/src/disputes/disputes-admin.schema.ts; packages/contracts/src/results/results-admin.schema.ts
- **location:** `RiderName` (стр. ~23); `PanelProtocolRecalculation.riderName` (стр. ~268)
- **problem:** `.claude/rules/pokatim-contracts.md:81-82`: «`PanelStandingRow.riderName` / `PanelRaceAttempt.riderName`
  — обязательные `nullable` (панель деплоится с API)». Новые поля той же природы (тот же экран, тот же порт) —
  `.nullable().default(null)` с мотивом «старый сервер без поля», которого у панели нет. Функционально безвредно
  (выходной тип тот же `string | null`), но: (а) две конвенции для одного вида поля в одной схеме; (б) API, забывший
  поле, молча даст «Участник ·id» вместо ошибки разбора (сейчас страхуют только int-проверки набора ключей);
  (в) `pokatim-contracts.md` не описывает новые поля, хотя перечисляет аналогичные — task.md §10 его не включил.
- **why_it_matters:** Documentation Sync и единообразие contracts-first; следующий автор не поймёт, какая конвенция верна.
- **evidence:** `const RiderName = z.string().nullable().default(null);` / правило в `pokatim-contracts.md:82`.
- **recommended_fix:** либо `z.string().nullable()` (как соседние `riderName` панели), либо осознанно оставить
  default и дописать в `pokatim-contracts.md` (раздел results/disputes) новые поля и причину отличия.

### [LOW] Дублирование имени в ответе разбора и неиспользуемое `complainantRiderName` в списке
- **file:** apps/api/src/modules/disputes/disputes-panel.service.ts; packages/contracts/src/disputes/disputes-admin.schema.ts
- **location:** `listItem` (стр. 34–46), `get` (стр. ~114–135); `PanelDispute.target.riderName`, `.complainant.riderName`
- **problem:** ответ разбора несёт каждое имя дважды (`targetRiderName` и `target.riderName`, `complainantRiderName` и
  `complainant.riderName`); UI разбора читает только вложенные. В списке колонка одна — цель; `complainantRiderName`
  панель не использует (grep по `apps/admin/src`), но имя заявителя отдаётся для каждой строки страницы.
- **why_it_matters:** минимизация ПДн в ответе (имя заявителя без потребителя) и две точки правды для одной величины.
  Решение задокументировано в task.md §8.2 п.1, поэтому LOW.
- **evidence:** `DisputesScreen.tsx:41` использует только `targetRiderName`; `DisputeScreen.tsx:46,81` — только
  `target.riderName` / `complainant.riderName`.
- **recommended_fix:** оставить имя только в одном месте (например, плоские поля строки и `riderLabel` по ним в
  разборе) или не отдавать `complainantRiderName` в списке, пока нет колонки.

### [LOW] `entriesByIds` — `session` стала необязательной для всех вызывающих
- **file:** apps/api/src/modules/results/results.repository.ts
- **location:** 1138–1139
- **problem:** ради одного внесессионного вызова (`recalculations`) сигнатура ослаблена для всех; прежние вызовы
  («Участники» после snapshot-сессии) теперь могут потерять `session` без ошибки типов.
- **why_it_matters:** правило `pokatim-backend.md` про чтение «Участников» в snapshot-сессии держалось и компилятором;
  сам внесессионный вызов корректен (`userId` заявки неизменен).
- **evidence:** `entriesByIds(ids: readonly string[], session?: DbSession)`.
- **recommended_fix:** отдельный метод (`entryUserIds(ids)` с проекцией `{ userId: 1 }`) — заодно меньше данных, — и
  вернуть обязательную `session` у `entriesByIds`.

Без замечаний: correctness списка/разбора/истории (публикация → `null`, без профиля → `null`, без согласия → `null`);
i18n (ключ `admin.disputes.rider` удалён, других ссылок нет, используется `admin.results.rider*`); состояния данных и
дизайн-система не затронуты; миграций, задач BullMQ, новых эндпоинтов и прав нет; e2e — секреты не печатаются в лог
(значение не в сообщениях `expect`; в trace/артефакте при падении видны ключ и коды одноразового аккаунта фиктивного
стенда — допустимо), CI job env достаточен (ключ задаёт `project.ts`, `PANEL_TOTP_ENFORCED` в CI не задан),
`.totp-enroll__secret code` — CSS-локатор вместо роли (мелочь, не выносил отдельно).
