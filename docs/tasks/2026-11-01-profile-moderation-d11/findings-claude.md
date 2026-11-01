# Findings — profile-moderation-d11 — pass 1 — reviewer: claude
base: origin/develop (3d490d01)   commits: origin/develop...ca17ec01 (45e5cd8a + merge)
verdict: APPROVE

Проверено (без находок): транзакции сброса и «Отклонить жалобы» — профиль пишется первой операцией
(`write` / `clearReports`), затем `openReporters` → `closeOpen` → outbox `profile.reports-resolved` → журнал → outbox
`profile.field-reset`; всё в одной `transactions.run`, повтор транзакции не дублирует outbox. Выборка авторов и
`closeOpen` идут в одном снапшоте транзакции после записи документа профиля; жалоба (`recordReport`) пишет тот же
документ → write conflict, набор авторов = набору закрытых (pokatim-db.md: «профиль первым»). Пустое закрытие — без
события. Payload — только id (`strictObject`, без имени/причины/id жалоб), лог — только флаги. Intake: `safeParse`
строгой схемой, `invalid_payload` → skipped, дедуп + исключение самого райдера, живость — `liveUserIds` в процессоре,
повтор задачи — `unchanged` (int-тест). kind в конце `NOTIFICATION_KINDS`, `kind: tolerantEnum` — старые сборки
приложения не падают; в приложении нет per-kind карт. Все вызывающие (`api-client`, панель: карточка и
«Результаты», int-тесты) переведены; CLI вызовов сброса нет. Журнал — append-only (`insertAudit`), `details`
проходят в `AuditEntry` как есть, старые записи без `resetReason` рендерятся как раньше. Контракт: `superRefine`
даёт `REQUIRED`/`INVALID` по пути `comment`, `UnblockRiderAvatarRequest` отвязан. Диалог — примитивы `../../ui`
(`RadioGroup`, `TextAreaField`, `Banner`, `Dialog`), ошибка в окне с `role="alert"`, Esc/«Отмена» блокированы во время
запроса. Тесты отрицательные есть (400 на трёх вариантах тела, битый payload, удалённый автор, повтор), `findBy` без
`timeout`.

### [MEDIUM] Продуктовый док панели описывает старое окно сброса
- **file:** docs/product/admin-panel.md
- **location:** строки 155–157 (карточка `/rider-profiles/:userId`), строка 42 (таблица прав)
- **problem:** «Сбросить фото / клуб / имя» и «Отклонить жалобы» — «окно с обязательной причиной и предупреждением
  «Не повторяйте имя или клуб в причине»»; «сброс закрывает открытые жалобы, райдер получает уведомление». После D11-1
  у сбросов причина — выбор из справочника, текст и предупреждение — только у «Другое»; после D11-2 уведомление
  получают и авторы жалоб (в т.ч. при «Отклонить жалобы»).
- **why_it_matters:** Documentation Sync: `admin-panel.md` — канон поведения панели; он противоречит `profile.md`
  (D11-1, D11-2) и `pokatim-web.md`, обновлённым в этом же PR. В §10 task.md файл не указан — пропуск в анализе
  влияния.
- **evidence:** `admin-panel.md:155-157` vs `profile.md` «D11-1 — причина сброса из списка», `pokatim-web.md` (diff:
  «Сбросы — `ResetReasonDialog` … у «Другое» — предупреждение …»).
- **recommended_fix:** обновить абзац карточки (сбросы — причина из списка, «Другое» — текст и предупреждение;
  «Отклонить жалобы»/«Снять запрет» — текст; авторам закрытых жалоб — «Жалоба рассмотрена») и строку 42 («Сбросить
  имя» в «Результатах» — причина из списка); добавить файл в §10 task.md.

### [LOW] pokatim-db.md: порядок записей сброса/«Отклонить» не дополнен чтением авторов и новым outbox
- **file:** .claude/rules/pokatim-db.md
- **location:** строки 99–103 («Порядок записи — профиль первым: … → `closeOpen` → журнал»)
- **problem:** правило перечисляет шаги транзакции, но не упоминает `openReporters` (чтение в транзакции до
  `closeOpen`, корректность которого держится именно на записи профиля первой) и outbox `profile.reports-resolved`.
- **why_it_matters:** инвариант «авторы = закрытые» неявный; будущая правка порядка (например, `closeOpen` до записи
  профиля или чтение авторов вне `tx`) сломает его без сигнала из правил. Описание есть только в `pokatim-backend.md`.
- **evidence:** `profile-moderation.service.ts:302-313` (`openReporters(tx, …)` → `closeOpen` → `outbox.append`);
  `pokatim-db.md:99-103`.
- **recommended_fix:** дописать в строку порядка: «… → `openReporters` (в той же транзакции) → `closeOpen` → outbox
  `profile.reports-resolved` (если закрыта ≥ 1) → журнал».

### [LOW] pokatim-security.md: тело `/v1/admin/profiles/*` всё ещё описано как `ActionReason`
- **file:** .claude/rules/pokatim-security.md
- **location:** строки 150–151
- **problem:** «тело — `strictObject` с `ActionReason`» — у `name-reset` теперь `{ reason: ProfileReportReason,
  comment?: ActionReason }`; ниже в том же пункте уже дописано про код, получилось противоречие внутри абзаца.
- **why_it_matters:** правило безопасности вводит в заблуждение при следующей правке валидации.
- **evidence:** `packages/contracts/src/profile/profile-admin.schema.ts:14-21`.
- **recommended_fix:** «тело — `strictObject` `{ reason: ProfileReportReason, comment?: ActionReason }`».

### [LOW] «Принял меры» уходит авторам жалоб на другое поле
- **file:** apps/api/src/modules/profile/profile-moderation.service.ts
- **location:** 276 (`closeReports(…, 'actioned', …)` в `reset`), `notification-texts.ts` (`profile_report_resolved`)
- **problem:** сброс клуба закрывает все открытые жалобы как `actioned`, включая жалобы на фото/имя; их авторы
  получают «рассмотрел вашу жалобу … и принял меры», хотя по их предмету ничего не сделано.
- **why_it_matters:** UX-неточность; поведение закрытия всех жалоб унаследовано (окно предупреждает модератора), а
  D11-2 явно говорит «каждому автору закрытой этим действием жалобы» — это решение владельца, не дефект реализации.
- **evidence:** `profile.md` D11-2; `i18n` `admin.results.dialog.resetNameConsequences` («закроются — и на фото и клуб
  тоже»).
- **recommended_fix:** вне scope; при желании — в Follow-up `profile.md` отметить (варианты: нейтральный текст
  «Модератор рассмотрел жалобы на профиль», либо закрывать только жалобы с причиной сброшенного поля).

### [LOW] Гонка «жалоба ↔ сброс» не проверяет набор авторов в событии
- **file:** apps/api/src/modules/profile/profile-reports.int.test.ts
- **location:** describe «гонка «жалоба ↔ сброс»» (~строка 270)
- **problem:** тест параллельных жалоб и сброса сверяет `openReportCount` с числом открытых, но не сверяет
  `reporterUserIds` события `profile.reports-resolved` с авторами жалоб, закрытых сбросом
  (`resolution: 'actioned'`). Корректность D11-2 под гонкой доказана рассуждением, не тестом.
- **why_it_matters:** регрессия порядка (чтение авторов не в `tx` / до записи профиля) пройдёт все тесты.
- **evidence:** в файле нет обращений к `PROFILE_REPORTS_RESOLVED` / `eventsOfType`.
- **recommended_fix:** в том же тесте: если событие есть — `sort(reporterUserIds)` равно авторам жалоб с
  `resolution: 'actioned'`; если нет — закрытых `actioned` ноль.

### [LOW] `ResetReasonDialog` — копия логики `ReasonDialog` без собственного теста
- **file:** apps/admin/src/features/rider-profiles/ResetReasonDialog.tsx
- **location:** 38–115
- **problem:** busy/error/Esc/сброс состояния продублированы из `ReasonDialog`; отдельного теста нет. Покрыто через
  экраны, кроме: ошибка сервера в окне «Сбросить имя» «Результатов» (`resultsErrorText`) и сброс выбора после
  «Отмена» (повторное открытие — пустой выбор). При выборе «Другое» фокус не переходит в поле текста.
- **why_it_matters:** расхождение двух диалогов при будущих правках `ReasonDialog`; мелкий a11y-штрих.
- **evidence:** `RaceResultsScreen.test.tsx` — только успешный путь сброса; `ReasonDialog.test.tsx` диалог сброса не
  покрывает.
- **recommended_fix:** `ResetReasonDialog.test.tsx` (отмена → повторное открытие без выбора; ошибка → окно открыто,
  `role=alert`; busy блокирует «Отмена»); по желанию `autoFocus` на поле при «Другое».

NOT VERIFIED: тесты и `pnpm check` не запускались (по заданию); поведение в браузере не проверялось.
