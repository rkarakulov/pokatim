# Findings — small-followups-panel — pass 2 — reviewer: claude (fallback)
base: origin/develop   commits: origin/develop..683500e8 (fixes pass 1 — 683500e8)
verdict: APPROVE

Закрытие находок pass 1 (по diff 683500e8, тесты не запускались по заданию — NOT VERIFIED локально):
- [MEDIUM] код входа e2e: `signInStep = Math.max(totpStep(), enrolledStep + 1)` считается прямо перед вводом
  (apps/admin/e2e/totp.spec.ts:129). Текущий == E → E+1 (в окне +1, не повтор `lastUsedStep`); текущий > E → текущий
  шаг. Закрыто.
- [LOW] `.default(null)`: `RiderName` и `PanelProtocolRecalculation.riderName` — обязательные `z.string().nullable()`;
  `.claude/rules/pokatim-contracts.md` дополнено. Закрыто.
- [LOW] дубли имени: в списке только `targetRiderName`, `complainantRiderName` удалено; `PanelDispute` —
  `.omit({ targetRiderName: true })`, имена только во вложенных `target`/`complainant`; сервис разбора строит
  `listBase` без имён; int-тест проверяет отсутствие плоского ключа в разборе. Закрыто.
- [LOW] `entriesByIds`: `session: DbSession` снова обязательна, единственный вызов (results-panel-read.service.ts:377)
  передаёт `session`; пересчёты — новый `entryUsers` с проекцией `{ _id, userId }`, пустой вход без запроса. Закрыто.

Новые проблемы: CRITICAL/HIGH/MEDIUM нет. Остатков `disputeRiderLabel` / `admin.disputes.rider` /
`complainantRiderName` в коде нет; других потребителей `PanelDispute*` (mobile/web) нет. Утечек имени в запись
(спор, журнал, аудит, лог) diff не добавляет.

### [LOW] Формулировка «список и разбор споров (цель и заявитель)» в документах расходится с контрактом
- **file:** docs/product/profile.md; docs/tasks/2026-11-01-small-followups-panel/task.md
- **location:** profile.md:69, :361; task.md AC §63 («Список и разбор спора: имя цели и заявителя»)
- **problem:** после фикса pass 1 имя заявителя есть только в разборе; в списке — только цель. Текст читается как
  «и в списке, и в разборе — обе стороны».
- **why_it_matters:** Documentation Sync — следующий исполнитель может вернуть `complainantRiderName` в список
  (лишние ПДн, решение §8.2 task.md это прямо отвергает).
- **evidence:** packages/contracts/src/disputes/disputes-admin.schema.ts — в `PanelDisputeListItem` нет поля
  заявителя; task.md:46 фиксирует «в списке — только targetRiderName».
- **recommended_fix:** уточнить: «список споров — цель; разбор — цель и заявитель» в profile.md и AC task.md.
