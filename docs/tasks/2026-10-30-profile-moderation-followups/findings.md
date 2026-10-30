# Findings — profile-moderation-followups — pass 1 — reviewer: claude
base: origin/develop   commits: 406a1fd6..c57c80fc (2 коммита, working tree чистый)
verdict: APPROVE

Проверено: task.md (§3, §8.1 RC-F1…F14, §8.2, §9, §10, §11), полный diff API/контрактов/api-client/панели/приложения/i18n/документов,
вызовы `openReportCount`/`closeOpen`/`clearReports` (все четыре закрывающие операции ставят `openReasons: []`),
`MongoTransactions`-путь сброса (профиль → `recordAvatarReset` → удаление фото / перевыпуск → `closeOpen` → журнал → outbox),
гонка замены фото (`before.avatarBlockedUntil` в `write()` + write conflict по документу профиля), миграция 0041,
совместимость старых клиентов (`ProfileView` не strict, `kind` — `tolerantEnum`, цель → `unknown`, `ProfileStateDetails.reason` —
`tolerantEnum`, `until` с default), ПДн в событии/журнале/логах (только id, код поля, время; лог «Снять запрет» без цели).

Прогоны ревьюера: api unit (`profile.policy`, `notification-intake`, `notification-texts`, `notifications.policy`,
`profile-reports.repository`) — 85/85; admin vitest `features/rider-profiles` — 29/29; app jest (`features/profile`,
`profile-screen`, `notification-target`, `service-worker`) — 111/111.
NOT VERIFIED: int-тесты на Mongo/Redis (`rider-profiles-moderation`, `profile-avatar-locks`, `notifications-intake`,
`profile-reports`, `migrations`) и `pnpm check` целиком — стенд в этом проходе не поднимался; опираюсь на отчёт coder в §12.

### [MEDIUM] Журнал панели не показывает срок запрета у «Сброшено фото участника», хотя admin-panel.md это обещает
- **file:** apps/admin/src/features/audit/AuditScreen.tsx
- **location:** `details()` строки 42–89
- **problem:** `details.avatarBlockedUntil` пишется в `panel_audit` и есть в контракте `AuditEntry`, но `details()` его не читает:
  для `profile.avatar_reset` срабатывает ветка `reportCount` («N жалоб»), дата запрета не выводится нигде в UI.
- **why_it_matters:** Documentation Sync — `docs/product/admin-panel.md:68` утверждает: «у «Сброшено фото участника» — дата
  окончания запрета, если его включил этот сброс». Модератор в журнале не видит, какой сброс включил запрет.
- **evidence:** `grep -rn avatarBlockedUntil apps/admin/src` — пусто; `AuditScreen.tsx:86-87` возвращает только
  `t('admin.audit.reportCount', …)`.
- **recommended_fix:** в `details()` при `entry.details?.avatarBlockedUntil` дописать к числу жалоб «запрет загрузки до
  <formatDateTimeLong>» (новый ключ i18n) + тест экрана журнала; либо поправить admin-panel.md, если показ не нужен.

### [LOW] Explain-тест очереди по причине не покрывает страницу с курсором
- **file:** apps/api/src/modules/profile/rider-profiles-moderation.int.test.ts
- **location:** «план запроса: IXSCAN profiles_report_reason_queue_idx без стадии SORT»
- **problem:** проверяется только первая страница (`$and` без keyset-`$or`); RC-F1 просил проверить отсутствие `SORT`
  для multikey-префикса — запрос со вторым условием `$or` (`lastReportAt`/`_id`) не проверен.
- **why_it_matters:** регресс плана на страницах 2+ (in-memory SORT по частичному индексу) тест не поймает.
- **recommended_fix:** добавить второй `explain` с тем же `$or`, что строит `reportQueue(after, …, reason)`.

### [LOW] Кнопка «Выбрать фото» остаётся неактивной после истечения запрета до перечитывания профиля
- **file:** apps/app/src/features/profile/avatar-editor.tsx, avatar-editor.web.tsx, avatar-section.tsx
- **location:** `disabled={blockedUntil !== null}`
- **problem:** клиент не сравнивает `blockedUntil` с текущим временем; открытый экран после момента окончания показывает
  «недоступна до <прошедшая дата>» и выключенную кнопку до фокуса/перезапроса (`useProfile` — `DEFAULT_STALE_MS`).
- **why_it_matters:** косметика/UX, авторитет сервера не страдает (сервер сам возвращает `null` после истечения).
- **recommended_fix:** по желанию — считать запрет активным только при `Date.parse(blockedUntil) > Date.now()` (после
  монтирования) или инвалидировать `['profile']` таймером на момент окончания.

Измерения без замечаний: correctness и гонки (запрет в транзакции замены, `openReasons` при жалобе/закрытии, outbox в
транзакции сброса, `{ reset: false }` без события), безопасность и ПДн, placement (`notifications → profile` только через
`index.ts`, без Nest-импорта), контракты и старые клиенты, серверный авторитет (счёт сбросов и срок — только сервер),
append-only журнал, миграция 0041 (expand-only, идемпотентна, окно RC-F11 принято и описано в pr.md), идемпотентность
intake (`sourceEventId`, `unchanged` в тесте), обработка ошибок (409 до слота с `Connection: close`), тесты по AC1–AC8,
i18n, дизайн-система панели (`ToggleChip`, `ReadonlyField`, `ReasonDialog`) и приложения (`Button` базы, роли темы),
web + native (оба редактора и тесты), документы §10 (кроме MEDIUM выше), правила `.claude/rules` не тронуты (предложения
в pr.md).
