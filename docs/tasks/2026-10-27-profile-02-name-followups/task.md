# 1. Title

Профиль 02: доработки публичного имени. Журнал согласия на показ имени, имя в панели «Протокол» (только с
согласием), сброс имени модератором в панели с причиной и записью в журнале действий.

# 2. Goal

Закрыть follow-up слайса `2026-10-27-profile-rider-name` (`docs/product/profile.md` → Follow-up):
1. Согласие на публичный показ ПДн сейчас — флаг `showNameInResults` без истории. Нужно, чтобы было доказуемо, когда
   и на какой текст райдер согласился и когда отозвал.
2. Панель «Протокол» показывает участников как «Участник ·{id}». Команде нужно видеть то же имя, что видит публика.
3. Оскорбительное или вводящее в заблуждение имя сейчас ничем не убрать. Нужен сброс модератором.

**Human gate пройден** (автор, 2026-10-26): Q1 — журнал вкл/выкл; Q2 — в панели имя только с согласием; Q3 —
«Сбросить имя» в панели с причиной и журналом, жалоб от райдеров нет.

# 3. Scope

**1. Журнал согласия (`profile`):**
- Новая коллекция `profile_consent_events`, только вставка. Поля: `_id`, `userId`, `kind: 'public_name'`,
  `action: 'granted' | 'revoked'`, `version` (версия текста пояснения у переключателя), `at` (`CLOCK`). Имени в
  записи нет.
- `PATCH /v1/profile` при **фактическом изменении** `showNameInResults` пишет событие в той же транзакции, что и
  документ профиля. Повтор того же значения события не пишет. Первое выключенное состояние по умолчанию — не событие.
- Версия текста — константа контракта (`PUBLIC_NAME_CONSENT_VERSION`, например `'2026-10-26'`), рядом с ключом i18n
  `profile.show.hint`. При смене формулировки версию поднимают; правило записать в `pokatim-contracts.md`.
- Клиент присылает только флаг. Версию и время ставит сервер.
- Удаление аккаунта (когда появится) удаляет документ профиля. Журнал остаётся: в нём нет ПДн, кроме `userId`.
  Записать в `pokatim-db.md`.
- Миграция `0019_profile_consents` (expand-only): коллекция и индекс `{ userId: 1, at: -1 }`. Номер проверить перед
  PR: параллельно идёт 06b.

**2. Имя в панели «Протокол» (`results` + `admin`):**
- Панельные ответы со строками участников (`results-admin.schema.ts`: standings, попытки и т. п. — architect
  перечислит) получают **добавленное** поле `riderName: string | null` через тот же порт `RIDER_NAMES` (только с
  согласием). `userId` в панели остаётся, как было.
- Админка: «Анна К. ·{id}» при имени, иначе «Участник ·{id}» (`results-format.ts`, новый ключ i18n). Правка
  минимальная.

**3. Сброс имени модератором:**
- Право `profiles.moderate` (в конец `PERMISSIONS`) — роли `admin`, `moderator`.
- `POST /v1/panel/profiles/:userId/name-reset` (`PanelGuard` + `profiles.moderate`), тело `{ reason }` (как у
  `ReasonDialog` других действий панели). Ставит `publicName: null`. Согласие не трогает, событие согласия не пишет.
  Пишет `PanelAudit.append` (действие `profile.name_reset` в конец `AUDIT_ACTIONS`; вид объекта — architect
  выберет из существующих `AUDIT_SUBJECT_KINDS` или добавит в конец). Всё в одной транзакции. **Сброшенное имя в
  журнал не пишется** (ПДн). Имени нет — идемпотентный успех без записи в журнал (или `409` — решает architect по
  образцу 05b, фиксирует в §8.1). Профиля нет — 404.
- Админка: в строке участника, где показано имя (п. 2), действие «Сбросить имя» (если есть право) через
  `ReasonDialog`. После успеха данные перечитываются.
- Приложение не меняется. Райдер видит пустое поле и может задать новое имя.

**Docs:** `docs/product/profile.md` (Q1–Q3, follow-up закрыты), `.claude/rules/pokatim-{db,security,contracts}.md`,
матрица ролей (где описаны права).

# 4. Out of Scope

- Жалобы райдеров на имя, очередь модерации имён.
- Блокировка смены имени после сброса, бан.
- Показ журнала согласий где-либо в UI.
- Имя где-либо ещё в панели, кроме экранов результатов гонки (споры 06 в панели — только если строки берутся из
  той же схемы; иначе follow-up).

# 5. Architecture Context

- `profile` — единственный писатель `profiles` и `profile_consent_events`. Сброс имени из панели — контроллер
  панели в `profile`. Образцы: панельные действия `rides` 05b — `PanelGuard`, право, `ReasonDialog`,
  `PanelAudit.append` в транзакции.
- `results` получает имена только через порт `RIDER_NAMES` (`ProfileCoreModule`).
- Транзакции — `withTransaction` проекта, правила `pokatim-db.md`.

## 5.1 Placement & Reuse Gate

Architecture Review (architect, 2026-10-26) — **Status: APPROVED** (блокеров нет; решения D1–D14 — §8.1).

**Placement:**
- Журнал согласий и сброс имени — модуль `profile` (единственный писатель `profiles` и `profile_consent_events`):
  коллекция и документ — `profile.collection.ts`, запись — только `ProfileRepository` (`ProfileCoreModule`).
- `PATCH /v1/profile` — `ProfileService.update` (транзакция `MongoTransactions.run`, D4).
- Сброс имени — новый HTTP-контроллер `profile-admin.controller.ts` (`@Controller('admin/profiles')`, D1) →
  `ProfileModerationService` (`profile-moderation.service.ts`) → `ProfileRepository.resetPublicName`. Оба — в
  `ProfileModule` (HTTP), не в `ProfileCoreModule` (worker о панели не знает). `ProfileModule` добавляет импорт
  `PanelModule` (`PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit` — только из
  `modules/panel/index.ts`). Циклов нет: `panel → identity`, `profile → identity, panel`, `results → profile, panel`.
- Имя в панели — `results`: `ResultsPanelReadService` (в `ResultsModule`) получает порт `RIDER_NAMES`;
  `ResultsModule` импортирует `ProfileCoreModule` (ядро `ResultsCoreModule` его не реэкспортирует, D9).
- Миграция — `apps/api/src/db/migrations/0019_profile_consents.ts` (expand-only).
- Админка — `apps/admin/src/features/results/*` (правка `StandingsTable`, `AttemptsTable`, `results-format.ts`);
  новых фич-папок и маршрутов нет.
- Новых пакетов нет; в app-foundation ничего не выносится (код доменный, потребитель один).

**Reuse (обязательно) / запрещённые дубли:**
- Транзакции — `MongoTransactions` из `apps/api/src/db` (как `RidesModerationService`), не своя обёртка сессий.
- Причина — `ActionReason` (`packages/contracts/src/admin/members.schema.ts`), не новая схема строки.
- Журнал — `PanelAudit.append(tx, …)`; своего журнала модерации в `profile` нет.
- Права — `ROLE_PERMISSIONS` (`panel/permissions.ts`), проверка — `PanelGuard` + `@RequirePermission`; на клиенте —
  `useCan`.
- Имена в панели — только порт `RIDER_NAMES` (`RiderNameDirectory.publicNames`); второго запроса к `profiles` из
  `results` нет, фильтр согласия — тот же `findPublicNames`.
- Админка: `ReasonDialog` через существующие `open` (`OpenResultsDialog`) и `run` (`useResultsAction` — инвалидация
  ключа гонки); `riderLabel` расширяется, вторую функцию подписи не заводить.
- Тестовые фикстуры: `namedRace`-подобная гонка из `results-names.int.test.ts` (`protocolRace` + `PATCH /v1/profile`),
  панельные сессии — `apps/api/test/panel.ts` (`memberUser`, `panelSession`, `panelCall`).

# 6. Relevant Files

- `apps/api/src/modules/profile/*`, `apps/api/src/modules/results/results-panel-read.service.ts`,
  `apps/api/src/modules/panel/*` (audit, права), `apps/api/src/db/migrations/*`
- `packages/contracts/src/{profile,results/results-admin.schema.ts,admin}`
- `apps/admin/src/features/results/*`, `packages/i18n/src/ru.ts`
- образец 05b: `apps/api/src/modules/rides/*moderation*`, `apps/admin/src/features/rides-moderation/*`

# 7. Implementation Notes

TDD. Int-тесты на реальной Mongo с изоляцией (`MONGO_URL_TEST` / `REDIS_URL_TEST` проекта). Имя — ПДн: не
логировать, не писать в журнал действий и журнал согласий.

# 8. Risks / Assumptions / Open Questions

- Q1–Q3 — решения автора (§2).
- [ASSUMPTION] Сброс не меняет `showNameInResults`: после нового имени оно сразу показывается, если согласие
  включено.
- Риск: номер миграции `0019` может занять 06b — перед PR синхронизироваться с develop и перенумеровать.

## 8.1 Requirements Consistency (заполняет architect)

Решения architect (2026-10-26). Q1–Q3 автора не пересматриваются. Блокеров нет.

- **D1 — путь сброса: `POST /v1/admin/profiles/:userId/name-reset`, а не `/v1/panel/...` (противоречие спеки).**
  Все маршруты панели — под `admin/*`: cookie сессии панели имеет `Path=/v1/admin` (по `/v1/panel/*` браузер её не
  отправит — всегда 401), а сторож `src/admin-routes.test.ts` (каждый маршрут под `PanelGuard`) обходит только
  `@Controller('admin…')`. Альтернатив нет; фиксируется как исправление спеки (§8.2 — coder отмечает).
- **D2 — сброс без имени: идемпотентный `200 { reset: false }` без записи журнала; с именем — `200 { reset: true }`
  и запись.** Ответ — `RiderNameResetResult { reset: boolean }`. Почему не `409` по образцу 05b: там `409` — защита
  оптимистической `version` и недопустимый переход объекта, состояние которого видит модератор. Здесь кнопка видна
  только при `riderName !== null`; «имя уже пусто» возникает только из гонки (райдер сам стёр имя, второй модератор
  успел раньше) — цель модератора уже достигнута, ошибка ему ничего не даёт. Журнал фиксирует только фактическое
  изменение (append-only без пустых записей). Альтернативы: `409` с новым кодом `PROFILE_NAME_EMPTY` (+ код ошибки,
  ветка в админке) — отклонено; `204` всегда — нельзя отличить исход в тестах и ответе. Профиля нет (любой `Uuid`,
  в т. ч. несуществующий пользователь) — `404 NOT_FOUND`. Имя есть, согласия нет (имя никому не видно) — сброс
  выполняется и журналируется (API не прячет; кнопки в админке нет).
- **D3 — объект журнала: новый вид `'rider'` в конец `AUDIT_SUBJECT_KINDS`;** запись —
  `{ action: 'profile.name_reset', actor: { kind: 'user', userId }, subject: { kind: 'rider', id: userId, label:
  'Участник ·<последние 6 символов userId>' }, reason, details: null }`, `targetUserId` — **не** заполняется.
  Причина: `PanelAuditReader` разрешает `targetUserId` через `panel_members`, и для райдера (не член команды) показал
  бы «Удалённый участник» — ложь в журнале. `label` — снимок без ПДн (не имя). Фильтр журнала `subjectId=<userId>`
  даёт историю сбросов райдера. Отклонены: `targetUserId` (выше); `subject: race` (у эндпоинта нет `raceId`, действие
  не о гонке). Ограничение: в «Участниках» короткий id — от `entryId`, в журнале — от `userId` (сопоставление — по
  `userId` строки панели); принято.
- **D4 — `PATCH /v1/profile` транзакционный.** Лимит `profile-update` — до транзакции (Redis вне колбэка). Внутри
  `transactions.run(tx)`: (1) `findProfile(userId, tx)` — прежний флаг `prev = before?.showNameInResults ?? false`;
  (2) `updatePublicName(tx, userId, patch, now)` (тот же pipeline-upsert, `{ session }`), ответ — документ после;
  (3) если `after.showNameInResults !== prev` — `insertConsentEvent(tx, { _id: uuidv7(), userId, kind:
  'public_name', action: after ? 'granted' : 'revoked', version: PUBLIC_NAME_CONSENT_VERSION, at: now })`.
  Чтение и запись **одного** документа в одной транзакции: параллельный `PATCH` получает конфликт записи и
  повторяется `run` на свежем снимке — двойного `granted` нет, `lockUser` не нужен (документы аккаунта не меняются).
  Гонка двух первых upsert (`isDuplicateKey(error, '_id_')`) — один повтор **всего** `run` (как
  `EntriesService`). `uuidv7()` — внутри колбэка (повтор — новый id, коммитится один). Первый `PATCH {false}` без
  документа — `prev = false`, события нет. Отклонено: одна операция `returnDocument: 'before'` + сборка ответа в
  коде (дублирует логику pipeline).
- **D5 — сброс — одна транзакция:** первой операцией — условная запись `profiles`
  `findOneAndUpdate({ _id: userId, publicName: { $type: 'string' } }, { $set: { publicName: null, updatedAt: now } },
  { session, projection: { _id: 1 } })`; совпало — `PanelAudit.append(tx, …)`; не совпало — `findOne({ _id }, {
  session, projection: { _id: 1 } })`: нет — `404`, есть — `{ reset: false }` без журнала. `showNameInResults` и
  `profile_consent_events` не трогаются (`[ASSUMPTION]` §8 принят). Параллельный `PATCH` райдера конфликтует по
  тому же документу — порядок любой корректен.
- **D6 — право `profiles.moderate`** — в конец `PERMISSIONS`; `ROLE_PERMISSIONS.moderator` += `profiles.moderate`
  (admin получает всё автоматически), organizer — нет. Экран «Результаты» модератору доступен (`races.read`).
- **D7 — лимита частоты на сброс нет** (как у `rides.moderate` 05b): действие команды платформы, каждое — в журнале.
- **D8 — `riderName` в панели:** обязательное `riderName: z.string().nullable()` (без `.default` — панель деплоится
  с API, правило `pokatim-contracts.md`, как `PanelRace.corridor`) в `PanelStandingRow` и `PanelRaceAttempt`.
  `PanelRaceAttempt` — это и ответы `exclude`/`restore` (`ResultsProtocolService` → `attemptView`), им тоже нужно
  имя. Не меняются: `PanelProtocolRecalculation` (только `entryId`, «Участник ·id» в `RecalculationsList`
  остаётся), споры в панели (своя схема — §4, follow-up). Имя читается **после** snapshot-сессии «Участников», один
  вызов порта на ответ; в снимок не пишется.
- **D9 — DI:** `ResultsModule.imports` += `ProfileCoreModule` (провайдер `RIDER_NAMES` для `ResultsPanelReadService`).
- **D10 — журнал согласий переживает удаление аккаунта (решение спеки)** — в отличие от `user_consents` (удаляются
  каскадом очистки *неподтверждённых*, где согласие так и не стало действующим). В событии только псевдонимный
  `userId`. Риск (не блокер): правомерность хранения доказательства согласия после удаления по закону РБ о защите ПДн —
  проверить юристом до прода; записать в `pokatim-db.md` и `profile.md` как принятое решение с этой оговоркой.
- **D11 — причина сброса может содержать само имя** (свободный текст модератора → append-only журнал с ПДн, его не
  удалить). Мера в слайсе: в тексте последствий `ReasonDialog` — «Не повторяйте имя в причине». Остаточный риск —
  в `profile.md`. Альтернатива на будущее — шаблонные причины (enum) вместо текста.
- **D12 — индекс** `profile_consent_events_user_idx { userId: 1, at: -1 }` (по спеке). Чтений в слайсе нет — индекс
  для выдачи доказательства и будущей обработки удаления; принято как часть решения Q1.
- **D13 — номер миграции:** на `origin/develop @ ddcec33` последняя — `0018_disputes`, ветки 06b на remote нет;
  `0019` свободен. Перед PR — `git fetch` и проверка; занят — перенумеровать (файл, `id`, тест).
- **D14 — логи:** `PATCH` — как сейчас (ничего). Сброс — после коммита одна строка `profile name reset by <actorUid>
  reset=<bool>`: без имени, причины и `userId` райдера (он в журнале; правило логов протокола). Константы
  `kind`/`action` журнала согласий — только в `profile.collection.ts` (наружу не выходят); в контрактах — только
  `PUBLIC_NAME_CONSENT_VERSION` (версия покрывает `profile.show.label` и `profile.show.hint`).

Конфликтов с инвариантами `AGENTS.md` §4 нет: append-only (§4.10) — `profile_consent_events` только `insertOne`,
`panel_audit` — через `PanelAudit`; серверный авторитет — версия, время и факт смены считает сервер. Сброс без
жалоб не противоречит §1 («модерация по жалобам») — решение автора Q3, очередь не вводится.

## 8.2 Deviations from spec

- **D1 (исправление спеки):** путь сброса — `POST /v1/admin/profiles/:userId/name-reset`, а не `/v1/panel/...`
  (cookie панели `Path=/v1/admin`, сторож `admin-routes.test.ts`). Реализовано по D1.
- **Колонка действий «Участников» до публикации** теперь есть у ролей с `profiles.moderate` (admin, moderator) — пустая
  ячейка у строк без имени. Существующий тест «участники: место «=2»…» ожидает 6-ю пустую ячейку (по §11 п. 9);
  организатор без права — 5 ячеек (новый тест).

## 8.3 Security checklist

- [x] Сброс — только `PanelGuard` + `profiles.moderate`; `userId` в пути проверяется как Uuid; чужие роли → 403.
- [x] Журнал действий без имени; журнал согласий без имени.
- [x] Имя в ответах панели — только при согласии (тот же порт, фильтр в запросе).
- [x] Событие согласия и профиль — в одной транзакции; версию задаёт сервер.
- [x] Логи без имени.

# 9. Acceptance Criteria

- AC1: `PATCH {showNameInResults: true}` (было `false`) → одно событие `granted` с версией сервера и `at`;
  повтор `true` → новых событий нет; `false` → `revoked`.
- AC2: `PATCH` только с `publicName` событий не пишет. Сбой записи события откатывает изменение флага
  (транзакция).
- AC3: миграция `0019` создаёт коллекцию и индекс, повтор идемпотентен.
- AC4: панельные строки результатов: `riderName` при имени и согласии, иначе `null`; без согласия имени нет.
- AC5: админка показывает «Имя ·id» / «Участник ·id».
- AC6: `POST …/name-reset` с правом → `publicName: null`, запись журнала `profile.name_reset` с причиной без
  имени, публичная таблица → `riderName: null`. Без права → 403, без причины → 400, профиля нет → 404.
- AC7: админка: «Сбросить имя» видно только с правом, `ReasonDialog`, после успеха строка показывает «Участник».
- AC8: `pnpm check` зелёный.

# 10. Documentation Impact

`docs/product/profile.md`, `.claude/rules/pokatim-{db,security,contracts}.md`, описание ролей и прав.

Уточнение architect (конкретные места):
- `docs/product/profile.md` — Q1–Q3 и D2/D3/D10/D11 (сброс без имени, вид объекта журнала, журнал после удаления,
  причина без имени); раздел «Где в продукте» — панель показывает имя (только с согласием), «Сбросить имя»;
  Follow-up — закрыть оба пункта, оставить жалобы на имя и шаблонные причины.
- `docs/product/admin-panel.md` — строка `profiles.moderate` в таблице прав (admin ✓, moderator ✓); журнал —
  действие «Сброшено имя участника».
- `.claude/rules/pokatim-db.md` — пункт про `profiles`: запись `PATCH` теперь в транзакции вместе с
  `profile_consent_events` (чтение+запись одного документа, без `lockUser`), повтор `_id_` — вокруг `run`;
  `profile_consent_events` — append-only (только `insertOne`, сторож), без имени, переживает удаление аккаунта;
  сброс модератором — условная запись + `PanelAudit` в одной транзакции.
- `.claude/rules/pokatim-security.md` — «Участие и результаты»: панель отдаёт `riderName` только с согласием; новый
  пункт: `/v1/admin/profiles/*` — `PanelGuard` + `profiles.moderate`, журнал без имени, лог без имени/причины.
- `.claude/rules/pokatim-contracts.md` — правило версии `PUBLIC_NAME_CONSENT_VERSION` (смена текста
  `profile.show.label`/`hint` → поднять версию); `PanelStandingRow`/`PanelRaceAttempt.riderName` — обязательное.
- `.claude/rules/pokatim-backend.md` — абзац `profile`: панельный контроллер `admin/profiles`, `ProfileModule`
  импортирует `PanelModule`; `ResultsPanelReadService` — порт `RIDER_NAMES`.
- `.claude/rules/pokatim-web.md` — «Результаты»: подпись строки «Имя ·id», «Сбросить имя» (`profiles.moderate`).

# 11. Implementation Context

(architect, 2026-10-26; решения — §8.1 D1–D14)

### ENTRY POINTS
- `PATCH /v1/profile` — `apps/api/src/modules/profile/profile.controller.ts` → `ProfileService.update`.
- `POST /v1/admin/profiles/:userId/name-reset` — новый `profile-admin.controller.ts` → `ProfileModerationService`.
- `GET /v1/admin/races/:raceId/standings`, `…/attempts`, `POST …/attempts/:id/exclude|restore` —
  `results-admin.controller.ts` / `results-protocol.controller.ts` → `ResultsPanelReadService`.
- Админка — `apps/admin/src/features/results/StandingsTable.tsx`, `AttemptsTable.tsx`.

### FILES TO MODIFY / CREATE

**Contracts (`packages/contracts/src`):**
- `profile/profile.schema.ts` — `export const PUBLIC_NAME_CONSENT_VERSION = '2026-10-26';` (JSDoc: версия текста
  `profile.show.label` + `profile.show.hint`; сменили текст — подняли версию).
- `profile/profile-admin.schema.ts` (новый) + экспорт в `index.ts`:
  `ResetRiderNameRequest = z.strictObject({ reason: ActionReason })`;
  `RiderNameResetResult = z.object({ reset: z.boolean() })`.
- `admin/permissions.schema.ts` — `'profiles.moderate'` в конец `PERMISSIONS` (комментарий `// profile-02`).
- `admin/audit.schema.ts` — `'profile.name_reset'` в конец `AUDIT_ACTIONS`, `'rider'` в конец
  `AUDIT_SUBJECT_KINDS`.
- `results/results-admin.schema.ts` — `riderName: z.string().nullable()` в `PanelRaceAttempt` и `PanelStandingRow`
  (JSDoc: только с согласием, порт `RIDER_NAMES`).
- Тесты: `admin/permissions.schema.test.ts`, `admin/audit.schema.test.ts` (точные массивы), `profile/profile.schema.test.ts`
  (`ResetRiderNameRequest`: без причины/короткая → `REQUIRED`/`TOO_SHORT`, лишний ключ → ошибка; константа версии).

**API (`apps/api/src`):**
- `db/migrations/0019_profile_consents.ts` (новый): `id: '0019_profile_consents'`, `ensureCollection(db,
  PROFILE_COLLECTIONS.consentEvents)` + `createIndex({ userId: 1, at: -1 }, { name: 'profile_consent_events_user_idx'
  })`; экспорт `PROFILE_CONSENTS_INDEXES` по образцу `DISPUTES_INDEXES`. `db/migrations/index.ts` — в конец.
- `modules/profile/profile.collection.ts` — `PROFILE_COLLECTIONS.consentEvents = 'profile_consent_events'`;
  `PROFILE_CONSENT_KINDS = ['public_name'] as const`, `PROFILE_CONSENT_ACTIONS = ['granted', 'revoked'] as const`;
  `interface ProfileConsentEventDoc { _id: string; userId: string; kind: 'public_name'; action: 'granted' |
  'revoked'; version: string; at: Date }` (JSDoc: append-only, без имени, переживает удаление аккаунта).
- `modules/profile/profile.repository.ts`:
  - `findProfile(userId: string, session?: DbSession)` — `{ session }` в `findOne`;
  - `updatePublicName(session: DbSession, userId, patch, now): Promise<ProfileDoc>` — session первым аргументом
    (конвенция `insertConsents`), `{ upsert: true, returnDocument: 'after', session }`;
  - `insertConsentEvent(session: DbSession, doc: ProfileConsentEventDoc): Promise<void>` — только `insertOne`;
  - `resetPublicName(session: DbSession, userId: string, now: Date): Promise<'reset' | 'empty' | 'not_found'>` —
    D5; JSDoc комментария класса обновить (запись `PATCH` и сброс — в транзакциях).
- `modules/profile/profile.service.ts` — инжект `MongoTransactions`; `update` по D4 (лимит → `run` → повтор `_id_`
  вокруг `run`).
- `modules/profile/profile-moderation.service.ts` (новый): `ProfileModerationService.resetName(actorUserId: string,
  userId: string, body: ResetRiderNameRequest): Promise<RiderNameResetResult>` — D2/D3/D5, `Logger` после коммита
  (D14). Подпись объекта журнала — функция `riderSubjectLabel(userId)` здесь же (`Участник ·${userId.slice(-6)}`).
- `modules/profile/profile-admin.controller.ts` (новый): `@Controller('admin/profiles') @UseGuards(PanelGuard)
  @RequirePermission('profiles.moderate')`; `@Post(':userId/name-reset') @HttpCode(200)`; `@Param('userId', new
  ZodValidationPipe(Uuid, FieldErrorCode))`, `@Body(new ZodValidationPipe(ResetRiderNameRequest, FieldErrorCode))`,
  `@CurrentPanelUser() actor: PanelPrincipal`. `no-store` ставит `PanelGuard`.
- `modules/profile/profile.module.ts` — `ProfileModule`: `imports` += `PanelModule`; `controllers` +=
  `ProfileAdminController`; `providers` += `ProfileModerationService`. `ProfileCoreModule` не меняется.
- `modules/panel/permissions.ts` — `moderator` += `'profiles.moderate'`; JSDoc карты — строка про profile-02.
- `modules/results/results.module.ts` — `ResultsModule.imports` += `ProfileCoreModule` (D9).
- `modules/results/results-panel-read.service.ts` — `@Inject(RIDER_NAMES) names: RiderNameDirectory` (из
  `../profile`); `attemptView(attempt, review, riderName: string | null)`; новый `async namedAttemptView(attempt,
  review): Promise<PanelRaceAttempt>` (один вызов порта); `attempts` — `publicNames(page.map(userId))` после выборки;
  `standings` — `publicNames(items.map(userId))` **после** `withSnapshot`, `riderName: names.get(userId) ?? null`.
- `modules/results/results-protocol.service.ts` — `exclude`/`restore`: `return this.read.namedAttemptView(attempt,
  review)` (после коммита, вне транзакции).
- `src/admin-routes.test.ts` — `ProfileAdminController` в список ожидаемых контроллеров (по желанию; обход
  `admin/*` подхватит его сам).

**api-client (`packages/api-client/src/admin.ts`):** `resetRiderName: (userId: string, body: ResetRiderNameRequest)
=> post(`/v1/admin/profiles/${encodeURIComponent(userId)}/name-reset`, RiderNameResetResult, body)` + тест в
`admin.test.ts` (URL, метод, тело, разбор ответа).

**Admin (`apps/admin/src/features/results`):**
- `results-format.ts` — `riderLabel(entryId: string, riderName: string | null = null)`: имя → `t('admin.results.riderNamed',
  { name, id })`, иначе прежний `admin.results.rider`. JSDoc «имён в панели нет (A12)» заменить.
- `StandingsTable.tsx` — колонка участника: `riderLabel(row.entryId, row.riderName)` (accessor на строку, не
  только `entryId`); `canModerate = useCan('profiles.moderate')`; колонка действий есть, если `(published &&
  canRevise) || canModerate`; в ячейке — прежние DQ-кнопки (только при `published && canRevise`) + «Сбросить имя»
  (`row.riderName !== null && canModerate`) → `open({ title, consequences, confirmLabel, destructive: true, run:
  (reason) => run(() => api.resetRiderName(row.userId, { reason })) })`.
- `AttemptsTable.tsx` — `riderLabel(attempt.entryId, attempt.riderName)`; действий сброса здесь нет.
- `RecalculationsList.tsx` — без изменений (имени нет в схеме).
- `packages/i18n/src/ru.ts` — блок `// profile-02`: `admin.results.riderNamed: '{name} ·{id}'`,
  `admin.results.action.resetName: 'Сбросить имя'`, `admin.results.dialog.resetName: 'Сбросить имя участника'`,
  `admin.results.dialog.resetNameConsequences` (имя исчезнет из таблиц; участник сможет задать новое; не повторяйте
  имя в причине — D11), `admin.audit.action.profile.name_reset: 'Сброшено имя участника'`. Рядом с
  `profile.show.label`/`hint` — комментарий: смена текста → поднять `PUBLIC_NAME_CONSENT_VERSION`.

### FILES TO READ
`profile.repository.ts`, `profile.service.ts`, `profile.int.test.ts`; `rides/rides-moderation.{controller,service}.ts`
(образец действия); `panel/panel-audit.ts`, `panel/permissions.ts(+test)`; `results/results-panel-read.service.ts`,
`results-protocol.service.ts`, `results-names.int.test.ts`; `db/migrations/0018_disputes.ts`, `0004_profile.ts`,
`migrations.int.test.ts`; `rides/ride-reports.repository.test.ts` (образец сторожа); `test/panel.ts`, `test/results.ts`;
админка — `StandingsTable.tsx`, `results-actions.ts`, `RaceResultsScreen.tsx(+test)`, `audit/AuditScreen.tsx`.

### TYPES & SCHEMAS
`PUBLIC_NAME_CONSENT_VERSION`, `ResetRiderNameRequest`, `RiderNameResetResult`, `Permission` (+`profiles.moderate`),
`AuditAction` (+`profile.name_reset`), `AuditSubjectKind` (+`rider`), `PanelStandingRow.riderName`,
`PanelRaceAttempt.riderName`, `ProfileConsentEventDoc`, `RiderNameDirectory` (без изменений).

### TESTS — порядок TDD
1. Контракты (unit): массивы прав/действий/видов, `ResetRiderNameRequest`, `riderName` в панельных схемах.
2. Миграция (int, AC3): `migrations.int.test.ts` — `'0019_profile_consents'` в списке применённых; новый `it`:
   коллекция есть, `indexesOf` = `{ profile_consent_events_user_idx: { key: { userId: 1, at: -1 }, unique: false, … } }`,
   `drop` → `up` ×2 — без ошибки, индексы те же; **перенести** `expect(migrations.at(-1)?.id)` из теста `0018` в
   тест `0019`.
3. Сторож (unit): `profile.repository.test.ts` (новый, образец `ride-reports.repository.test.ts`) — к
   `this.consentEvents` только `insertOne`, нет `delete|replace|update` для неё; имя `profile_consent_events` знают
   только `profile.collection.ts`, репозиторий и миграция.
4. `PATCH` (int, `profile.int.test.ts`):
   - AC1: нет документа → `{true}` → одно событие `{ userId, kind: 'public_name', action: 'granted', version:
     PUBLIC_NAME_CONSENT_VERSION, at: <CLOCK> }`, ключи документа — ровно эти + `_id`, имени нет; повтор `{true}` —
     событий 1; `{false}` → `revoked`; первый `{false}` без документа — 0 событий; `{true}` с `publicName` — одно
     событие и имя.
   - AC2: только `publicName` — 0 событий; `vi.spyOn(ProfileRepository.prototype | instance, 'insertConsentEvent')
     .mockRejectedValueOnce` → 500, в документе прежние флаг **и** имя, событий 0.
   - Гонка (отрицательное доказательство): `Promise.all` двух `PATCH {true}` от `false` → ровно одно `granted`;
     вариант с чтением `prev` вне транзакции/до `run` даёт два — результат в §12.
5. Сброс (int, новый `profile-admin.int.test.ts`, AC6): admin и moderator → `200 { reset: true }`, `publicName: null`,
   `showNameInResults` прежний, событий согласия не добавилось; запись `panel_audit` — `action: 'profile.name_reset'`,
   `subject: { kind: 'rider', id: userId, label: 'Участник ·…' }`, `targetUserId: null`, `reason`, и
   `JSON.stringify(doc)` не содержит имени; `RIDER_NAMES.publicNames([userId])` — пустая карта; повтор → `{ reset:
   false }`, записей журнала по-прежнему 1; профиля нет → 404; organizer → 403; без сессии панели (Bearer
   приложения) → 401; `userId` не Uuid → 400; без `reason` / `'ab'` / лишний ключ → 400 `VALIDATION_FAILED`;
   сбой `PanelAudit.append` (spy) → имя на месте (транзакция). После сброса райдер `PATCH {publicName}` — имя снова
   видно (ASSUMPTION §8).
6. Панель (int, расширить `results-names.int.test.ts`, AC4/AC6): `namedRace` → `GET …/standings` (live и после
   публикации) и `…/attempts` — `riderName` только у «имя+согласие», у остальных `null`, `userId` на месте; ответ
   `exclude` содержит `riderName`; после `name-reset` публичная таблица и панель → `null`.
7. `permissions.test.ts` (unit): moderator — `profiles.moderate`; organizer — нет; `permissionsOf` в порядке контракта.
8. api-client (unit): `resetRiderName`.
9. Админка (Vitest, `RaceResultsScreen.test.tsx`, AC5/AC7): фикстуры `row()`/`attempt()` получают `riderName: null`;
   «Анна К. ·9a0a01» при имени, «Участник ·…» без; «Сбросить имя» — только с `profiles.moderate` и при имени; клик →
   `ReasonDialog` → вызов `resetRiderName(userId, { reason })` → перечитывание, строка «Участник ·…». Колонка действий
   до публикации появляется только из-за права модерации.
10. `pnpm check` (AC8).

### Тест-матрица (AC → тест)
| AC | Уровень | Где |
|---|---|---|
| AC1 | int | `profile.int.test.ts` (события, повтор, первый false, гонка) |
| AC2 | int | `profile.int.test.ts` (только имя; откат по spy) |
| AC3 | int | `migrations.int.test.ts` |
| AC4 | int | `results-names.int.test.ts` (standings, attempts, exclude) |
| AC5 | unit (admin) | `RaceResultsScreen.test.tsx` |
| AC6 | int + unit | `profile-admin.int.test.ts`, `results-names.int.test.ts`, `permissions.test.ts`, контракты, `admin-routes.test.ts` |
| AC7 | unit (admin) | `RaceResultsScreen.test.tsx` |
| AC8 | gate | `pnpm check` |
e2e (`pnpm e2e:admin`) — не обязателен: маршрутов и CSP не меняем; прогнать смоук, если трогается навигация.

### OUT OF SCOPE
Приложение `apps/app` (ProfileView не меняется); экран и API чтения журнала согласий; имя в спорах и истории
пересчётов панели; жалобы на имя, блокировка смены имени; шаблонные причины сброса (D11); удаление аккаунта.

### На что смотреть ревьюеру
- `PATCH`: чтение прежнего флага — **внутри** `run` и до записи того же документа; повтор `_id_` — вокруг `run`;
  лимит — вне `run`; событие только при фактической смене; версия и `at` — сервер.
- Сброс: условная запись профиля — первая операция транзакции; `PanelAudit.append` в той же `tx`; ни имени, ни
  прежнего значения в журнале, логах, ответе; `targetUserId` не заполнен (D3); `reset: false` — без записи.
- Маршрут — `admin/profiles` (D1), `PanelGuard` + `RequirePermission('profiles.moderate')` на классе.
- `profile_consent_events` — только `insertOne` (сторож), без имени.
- `riderName` в панели — только через `RIDER_NAMES` после snapshot-сессии; `results` не читает `profiles` напрямую;
  `exclude`/`restore` тоже отдают имя.
- Контракты: только добавление в конец (`PERMISSIONS`, `AUDIT_ACTIONS`, `AUDIT_SUBJECT_KINDS`); новые i18n-ключи
  для действия журнала (иначе typecheck `AuditScreen`).
- Миграция — expand-only, без транзакции, идемпотентна; номер сверен с develop (D13).

# 12. Outcome (заполняет coder)

(coder, 2026-10-26)

**Сделано** — по §11 и D1–D14, без отклонений сверх §8.2.
- Контракты: `PUBLIC_NAME_CONSENT_VERSION = '2026-10-26'`, `profile-admin.schema.ts` (`ResetRiderNameRequest`,
  `RiderNameResetResult`), `profiles.moderate` в конец `PERMISSIONS`, `profile.name_reset` / `rider` в конец
  `AUDIT_ACTIONS` / `AUDIT_SUBJECT_KINDS`, обязательный `riderName` в `PanelStandingRow` и `PanelRaceAttempt`.
- API: миграция `0019_profile_consents` (коллекция + `profile_consent_events_user_idx`); `PATCH /v1/profile` —
  транзакция (прежний флаг читается внутри, событие только при фактической смене, повтор `_id_` вокруг `run`);
  `POST /v1/admin/profiles/:userId/name-reset` (`ProfileAdminController` → `ProfileModerationService` →
  `ProfileRepository.resetPublicName` + `PanelAudit.append` в одной транзакции, лог после коммита без имени/причины/
  `userId` райдера); `moderator` += `profiles.moderate`; `ResultsPanelReadService` — порт `RIDER_NAMES` для
  standings (после snapshot-сессии), attempts и ответов exclude/restore (`namedAttemptView`); `ResultsModule` импортирует
  `ProfileCoreModule`.
- api-client: `resetRiderName`. Админка: `riderLabel(entryId, riderName)`, «Сбросить имя» в `StandingsTable`
  (`profiles.moderate` + имя, `ReasonDialog` с «Не повторяйте имя в причине» — D11). i18n — блок profile-02 и
  комментарий у `profile.show.*`.
- Docs: `docs/product/profile.md`, `docs/product/admin-panel.md`, `.claude/rules/pokatim-{db,security,contracts,backend,web}.md`.

**Тесты (новые/расширенные):** контракты (массивы прав/действий/видов, `ResetRiderNameRequest`, `riderName`);
`migrations.int.test.ts` (0019, `at(-1)` перенесён); сторож `profile.repository.test.ts`; `profile.int.test.ts`
(AC1/AC2, откат по spy, гонка); `profile-admin.int.test.ts` (AC6: admin/moderator, повтор `reset:false`, без
согласия, 404, 401/403, 400, откат по spy журнала, новое имя после сброса); `results-names.int.test.ts` (standings
live/protocol, attempts, exclude, после name-reset); `permissions.test.ts`, `admin-routes.test.ts`,
`panel.guard.test.ts`/`panel-session.int.test.ts` (точные списки прав — + `profiles.moderate`); `admin.test.ts`
(api-client); `RaceResultsScreen.test.tsx` (AC5/AC7).

**Отрицательное доказательство (гонка `PATCH`, §11 п. 4):** чтение прежнего флага вынесено из `run`
(`findProfile(userId)` без сессии до транзакции) → `гонка двух PATCH true от false` красный 3/3 прогона:
`AssertionError: expected 2 to be 1` (два `granted`). С чтением внутри транзакции — зелёный 3/3. Код возвращён.

**D13:** `git fetch` — на `origin/develop` и `origin/feature/race-results-06b-series` последняя миграция
`0018_disputes`; `0019` свободен на 2026-10-26. Перед PR — проверить снова.

**Проверки** (изоляция: `MONGO_URL_TEST=…/pokatim_profile_test`, `REDIS_URL_TEST=…:6479/9`):
- `TURBO_CONCURRENCY=1 pnpm check` (прогон 1) → api: `3 failed | 947 passed (950)`: два теста с точным списком прав
  модератора (`panel.guard.test.ts`, `panel-session.int.test.ts`) — обновлены (+ `profiles.moderate`); `seasons.int.test.ts`
  — таймаут под нагрузкой, отдельно зелёный (`3 passed (3)`, 35 тестов).
- `TURBO_CONCURRENCY=1 pnpm check` (прогон 2) → `EXIT=0`, `Tasks: 13 successful, 13 total`; contracts 224, api-client
  74, api `95 files / 950 passed`, admin `23 files / 216 passed`, i18n 6, tracks 202; format, lint, arch (982 модуля,
  нарушений нет), typecheck — зелёные.

e2e (`pnpm e2e:admin`) не запускался: маршруты и CSP панели не менялись.

## Независимое ревью

- Pass 1 (Claude `independent-reviewer`, ddcec33..086942d) — **APPROVE**: CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 3.
  LOW-2 (ответ «Вернуть» с `riderName` без теста) — закрыт тестом в `results-names.int.test.ts`. LOW-1 (подпись
  «Участник ·id» журнала собирается на сервере) и LOW-3 (в журнале короткий id пользователя, в таблице — заявки) —
  приняты по D3, follow-up: префикс подписи — через i18n в `AuditScreen` по `subject.kind`.
