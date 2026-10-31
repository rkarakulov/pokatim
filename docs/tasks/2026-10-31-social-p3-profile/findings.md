# Findings — social-p3-profile — pass 1 — reviewer: claude
base: beca1db2 (HEAD = origin/develop)   commits: working tree (не закоммичено)
verdict: APPROVE

Проверено самостоятельно (изоляция: `pokatim_social_p3_review_test`, Redis db 11; имя без суффикса `_test`
отвергает `recreateTestMongoDatabase` в global-setup):
- `vitest run rider-social.int.test.ts social-connections.int.test.ts rides-for-social.int.test.ts` → 3 files, 29 passed.
- `jest social-screen rider-profile own-profile home features/social features/home` → 9 suites, 124 passed.
- Полный `pnpm check`, e2e `/social` (Playwright) и ручная проверка на iOS/Android/web — NOT VERIFIED (по
  указанию оркестратора / нужен build:web и устройство).

Измерения без замечаний: correctness API (порядок проверок PUT: findPublic → self 409 → addManual/remove; `going`
только при `inTheirs`; фильтр `status: 'published'` отсекает `hidden`/`cancelled`, `startsAt > now`); placement
(контроллеры и сервис в `social`, порт `RIDES_FOR_SOCIAL.nextRideCard`, `rideCardOf` переиспользован в `list` без
копии; DI — `RideReportsRepository` и `RIDE_ROUTES` есть в `RidesCoreModule`); безопасность (`AuthGuard` на классах,
`no-store` и на 404, `publicId` — zod-pipe, `strictObject` тела, в ответах нет `userId` — проверено int-тестом,
логов с PII нет; `SecureKey` — только нечувствительный ключ); контракты (только новые эндпоинты и схемы,
`going` с `.default(null)`, `tolerantEnum` источников; публичный `GET riders/:publicId` не тронут); серверный
авторитет (`self`/`connected`/`together`/`going`/`viewer` — сервер); миграций нет; BullMQ не затронут; RC-P3-2a
(повтор `isDuplicateKey` убран, ворота в обоих путях, отрицательное доказательство в §12); состояния данных
(скелетоны, `AsyncContent` с повтором, пустое состояние, `loading` у кнопок, ошибки у кнопки); платформы (`.web`
хранилища отложки, SSR `/social` без данных за `useSettingsShell`, `SEO_DISALLOW`); i18n — в конце `ru.ts`, плюралы.

### [MEDIUM] Экран «Свои»: локальная отметка «убран» переживает перезапрос списка и противоречит серверу
- **file:** apps/app/src/features/social/social-screen.tsx
- **location:** `ConnectionsList` (`useState<ReadonlySet<string>> removed`), `SocialScreen` (`useFocusEffect` cleanup)
- **problem:** множество `removed` живёт, пока смонтирован `ConnectionsList`, и не сбрасывается при новых данных.
  Сценарий: на `/social` «В своих» у Анны → строка с «В свои» (`removed` = {Анна}) → нажатие строки → профиль Анны
  (blur инвалидирует `['social']`, список под стеком перезапрашивается) → на профиле «В свои» → связь восстановлена
  (`refreshList: true` снова инвалидирует список) → «Назад»: сервер вернул Анну в `items`, но `removed.has(Анна)`
  → кнопка «В свои» при `connected: true` на сервере.
- **why_it_matters:** экран показывает состояние, противоречащее серверу (§7 task.md «клиент только показывает»);
  нажатие делает лишний `PUT true` и тратит попытку лимита K11 (30/24 ч) ради исправления подписи.
- **evidence:** `const [removed, setRemoved] = useState(...)` в `ConnectionsList`; `removed={removed.has(row.publicId)}`;
  сброса по `dataUpdatedAt`/фокусу нет; `useSetRiderConnection(..., { refreshList: true })` в `rider-social-block.tsx`
  инвалидирует `['social','connections']`.
- **recommended_fix:** сбрасывать `removed` при получении новых данных списка (например, `key={connections.dataUpdatedAt}`
  на `ConnectionsList` или эффект по `dataUpdatedAt`), либо брать состояние кнопки из `['social','rider',publicId]`
  (его уже пишет `setQueryData` мутации), когда оно свежее данных списка. Jest: убрать → уйти на профиль → вернуть
  на профиле → назад — кнопка «В своих».

### [LOW] Неиспользуемый ключ i18n `social.failed`
- **file:** packages/i18n/src/ru.ts
- **location:** `'social.failed': 'Не удалось загрузить «Свои»'`
- **problem:** ключ нигде не используется (grep по `apps/app/src`, `packages` — только определение); ошибки экрана
  и блока — общий текст `AsyncContent`.
- **why_it_matters:** мёртвая строка в каталоге; либо задуманный текст ошибки не показан.
- **evidence:** `grep -rn "social\.failed" apps/app/src packages/i18n/src` → только `ru.ts:3264`.
- **recommended_fix:** передать текст в `AsyncContent` экрана «Свои» / блока профиля или удалить ключ.

### [LOW] Правило `pokatim-backend.md`: строка «Композиция» не обновлена под P3
- **file:** .claude/rules/pokatim-backend.md
- **location:** раздел «Свои», пункт «Композиция (RC-13)»
- **problem:** по-прежнему «`SocialModule` (`AppModule`, контроллеры — P2–P4, P7)»; теперь `SocialModule` содержит
  контроллеры P3 и импортирует `IdentityModule`, `ProfileCoreModule`, `RidesCoreModule` (это описано отдельным пунктом
  «Профиль (P3)», но строка композиции противоречит).
- **why_it_matters:** Documentation Sync (§10 task.md) — следующая сессия по правилу решит, что контроллеров ещё нет.
- **recommended_fix:** «`SocialModule` (`AppModule`; imports `IdentityModule`, `ProfileCoreModule`, `RidesCoreModule`;
  контроллеры P3 — `RiderSocialController`, `SocialConnectionsController`; далее P2, P4, P7)».

### [LOW] `pr.md` из §10 ещё не создан
- **file:** docs/tasks/2026-10-31-social-p3-profile/ (нет `pr.md`)
- **location:** —
- **problem:** §10 требует `pr.md` (новые эндпоинты, совместимость, правка `SecureKey`); в каталоге только `task.md`.
- **why_it_matters:** Documentation Sync; вероятно, шаг FINISH — отмечаю, чтобы не потерялся.
- **recommended_fix:** создать на FINISH вместе с решением RC-P3-4 (`source: 'profile'` / follow-up).

Блокирующих (CRITICAL/HIGH) нет.

## Исправления оркестратора (2026-10-31)

- **MEDIUM (убранные не сбрасываются) — исправлено:** `ConnectionsList` получает `key` = `dataUpdatedAt` списка
  (`social-screen.tsx`): новый ответ сервера перемонтирует список и сбрасывает «убранные на экране». Тест «новый ответ
  списка сбрасывает убранные на экране» в `social-screen.test.tsx`; отрицательное доказательство — без `key` тест
  красный (`1 failed, 8 passed`), с `key` — `9 passed`.
- **LOW `social.failed` — исправлено:** неиспользуемый ключ удалён из `ru.ts`.
- **LOW «Композиция» в `pokatim-backend.md` — исправлено:** `SocialModule` — контроллеры P2 (райд), P3 (профиль), P4, P7.
- **LOW `pr.md` — на шаге FINISH.**

# Findings — social-p3-profile — pass 2 — reviewer: claude
base: beca1db2 (HEAD = origin/develop)   commits: working tree (не закоммичено)
verdict: APPROVE

Проверены исправления pass 1. Свой прогон: `jest src/__tests__/social-screen.test.tsx` → 9 passed. Остальное не
запускал: полный `pnpm check` идёт у оркестратора.

- **MEDIUM (убранные не сбрасываются) — решено.** `SocialScreen` передаёт `key={connections.dataUpdatedAt}` в
  `ConnectionsList`: любой новый ответ сервера перемонтирует список, и состояние «убран» сбрасывается, поэтому
  возврат из профиля показывает «В своих». Мутации экрана список не инвалидируют (`refreshList: false`), так что
  отметка не теряется сразу после нажатия. Новый тест «новый ответ списка сбрасывает убранные…» проверяет поведение:
  ответ структурно тот же, меняется только `dataUpdatedAt`. Отрицательное доказательство оркестратора: без `key` тест
  красный.
- **LOW `social.failed` — решено:** ключ удалён из `ru.ts`, использований нет.
- **LOW «Композиция» — решено:** строка правила теперь «контроллеры — P2 (райд), P3 (профиль), P4, P7».
- **LOW `pr.md` — открыт:** отложен на FINISH, как и договорено.

Наблюдение, не находка: если во время запроса `PUT` на экране «Свои» пользователь потянет список для обновления или
список перезапросится по фокусу, строка перемонтируется и колбэк `onSuccess` этого нажатия не сработает. Сервер всё
равно применит запрос, а свежий список показывает его состояние. Расхождения с сервером нет, исправлять не нужно.

Новых находок нет. CRITICAL/HIGH нет.
