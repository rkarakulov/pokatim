# Claude pass 1

# Findings — race-results-04-app — pass 1 — reviewer: claude
base: origin/develop   commits: 042c14e..1ca06fc (working tree clean)
verdict: APPROVE

Проверено: `git diff origin/develop...HEAD` (33 файла), правила `AGENTS.md`, `.claude/rules/{app,pokatim-app,tests,pokatim-tests,security,pokatim-security}.md`,
контракт `packages/contracts/src/results/results.schema.ts`, хук `use-track-file-upload.ts` целиком, гард `_layout.tsx`, очистка кеша при выходе
(`use-sign-out.ts` — `queryClient.clear()`, поэтому ключ участия без userId безопасен).
Запущено: `npx jest` по race-participation / race-results / race-pick / race-detail / devices-screen / features/races — 9 suites, 196 tests passed;
`npx tsc --noEmit -p apps/app` — exit 0. `pnpm check` целиком и e2e web — NOT VERIFIED (не запускались ревьюером).

Измерения без находок: безопасность (только намерение в мутациях, токен через `withAccessToken`, таблица анонимна, «Вы» — только клиент),
серверный авторитет (`can*`, статус, место, время — из ответа; F1 — выбор текста, не правило), contracts-first (контракты/API не менялись),
миграции / BullMQ / аудит — не затронуты, placement (§5.1 соблюдён: один хук загрузки, общий `UploadProgress`, `FakeXhr` вынесен, логика —
в `participation-format.ts` с тестами), i18n (9 ключей §11, дублей нет), Documentation Sync (§10 выполнен: product, epic, pokatim-app.md),
все платформы (развилок `Platform.OS` нет, выбор файла уже развилен файлами; SSR карточки не меняется — блок участия при `unknown`-сессии
не рисуется, таблица в SSR — только скелетон, без гидрационных расхождений), регрессия «Устройств» (ожидания не менялись, тесты зелёные).

### [MEDIUM] Ответ мутации участия может быть перезаписан устаревшим опросом / refetch участия
- **file:** apps/app/src/features/races/queries.ts
- **location:** `applyEntry` (стр. 221–227), `useEntryMutation` (стр. 230–242); опрос — `useMyRaceEntry` `refetchInterval` (стр. 175)
- **problem:** `applyEntry` делает `setQueryData(raceEntryKey)` без `cancelQueries` для `['races','entry',id]`. Если в этот момент летит
  запрос опроса (каждые 3 с при `queued|checking|pending`) или refetch по фокусу/pull-to-refresh, начатый до мутации, его ответ
  (состояние до мутации) приходит позже и перезаписывает кеш (TanStack Query не отбрасывает результат in-flight fetch после setQueryData).
- **why_it_matters:** сценарии: (1) «Отменить участие» во время опроса → панель закрывается, блок на миг `withdrawn`, затем снова активная
  заявка с «Отменить участие»; повторное нажатие → 409. (2) Устаревший ответ, в котором проверка уже завершилась, но ещё нет новой попытки
  (добавлена с экрана выбора, карточка в стеке продолжает опрос) → `needsPolling` = false → опрос останавливается, новая `queued`-попытка
  и последующее место не появляются до фокуса/pull-to-refresh — нарушает AC6/AC7/AC9 («кеш участия обновлён», место появляется тихо).
- **evidence:** `queryClient.setQueryData(raceEntryKey(entry.raceId), entry);` без предварительного `await queryClient.cancelQueries({ queryKey: raceEntryKey(...) })`;
  `refetchInterval: (q) => (needsPolling(q.state.data) ? ENTRY_POLL_MS : false)` решает по последним данным, т.е. по устаревшему ответу.
- **recommended_fix:** в `useEntryMutation` добавить `onMutate: () => queryClient.cancelQueries({ queryKey: raceEntryKey(id) })` и/или
  `await queryClient.cancelQueries(...)` в `applyEntry` перед `setQueryData`. Тест: опрос с отложенным `getMyRaceEntry`, мутация
  резолвится раньше — в кеше остаётся ответ мутации.

### [MEDIUM] Ошибка «Отменить участие» исчезает сразу после перезапроса участия (F14) — тест ложно-зелёный
- **file:** apps/app/src/features/races/participation/entry-actions.tsx
- **location:** стр. 91–103 (`actions.canWithdraw ? (confirming ? <WithdrawConfirm/> …) : null`); queries.ts стр. 236–240
- **problem:** при 409 `RACE_WITHDRAW_CLOSED` `onError` инвалидирует участие; реальный сервер в ответе даст `canWithdraw: false` →
  `WithdrawConfirm` размонтируется вместе с текстом ошибки (`withdraw.error` живёт в его `useMutation`). Взамен ничего не показывается:
  `addAttemptBlockReason` намеренно не берёт `window_closed` (F1), а причины отмены блок не выводит вовсе.
- **why_it_matters:** §7.4 / AC9: «ошибка — текст под кнопками». Райдер нажал «Отменить участие», панель молча пропала — без объяснения,
  что окно уже закрыто. Тест `409 RACE_WITHDRAW_CLOSED — текст под кнопками` проходит только потому, что мок перезапроса возвращает
  прежний `myEntry()` с `canWithdraw: true` — не так, как ответит сервер.
- **evidence:** race-participation.test.tsx стр. 516–523: `getMyRaceEntry.mockResolvedValue(myEntry())` из `beforeEach`; после 409 —
  повторный `getMyRaceEntry` с тем же `canWithdraw: true`.
- **recommended_fix:** поднять ошибку/мутацию отмены в `EntryActions` (или хранить последний текст отказа в состоянии `EntryActions`) и
  показывать её и после того, как `canWithdraw` стал false; либо, если `!canWithdraw` и в `reasons` есть `window_closed`, — строка
  `races.block.window_closed` рядом. Тест: после 409 перезапрос возвращает `canWithdraw: false, reasons: ['window_closed','upload_closed']`,
  текст отказа виден.

### [LOW] Флип `canAddAttempt` во время отправки прячет прогресс и «Отменить»
- **file:** apps/app/src/features/races/participation/entry-actions.tsx
- **location:** стр. 54–83
- **problem:** `UploadProgress` рисуется только внутри `actions.canAddAttempt ? …`. Если опрос (активен при `pending`) принесёт
  `canAddAttempt: false` (наступил `uploadClosesAt`) посреди отправки, хук продолжит загрузку, но прогресс и «Отменить» исчезнут;
  затем второй шаг даст 409 `ATTEMPT_UPLOAD_CLOSED` (баннер есть).
- **why_it_matters:** редкий край у дедлайна; пользователь не видит идущую отправку и не может её отменить.
- **evidence:** `{actions.canAddAttempt ? (<View …>{upload.state.phase === 'uploading' ? <UploadProgress …/> : <Button …/>}…`
- **recommended_fix:** показывать `UploadProgress` при `upload.state.phase === 'uploading'` независимо от `canAddAttempt`.

### [LOW] `'unknown'` причина любого действия перебивает свою причину (F1)
- **file:** apps/app/src/features/races/participation-format.ts
- **location:** `firstReason`, стр. 42–45
- **problem:** `'unknown'` принимается как «своя» причина для обоих подмножеств. Новая серверная причина отмены (→ `unknown`), стоящая
  перед `upload_closed`, даст «Действие недоступно» вместо «Срок загрузки заездов истёк» — тот же класс ошибки, что F1 закрывал для
  `window_closed`.
- **why_it_matters:** нейтрально и не ломает экран (AC13), но текст хуже при эволюции API.
- **evidence:** `(reason): reason is BlockReason => reason === 'unknown' || own.includes(reason)`
- **recommended_fix:** сначала искать причину из своего подмножества, `'unknown'` — только если своей нет.

### [LOW] Полоса своей строки таблицы — токены не по назначению
- **file:** apps/app/src/features/races/results-table.tsx
- **location:** стр. 29, 138–139
- **problem:** ширина полосы — `stroke.bannerError`, цвет рамки — `theme.text.accent` (текстовая роль), ширина колонки места — `space.s6`.
- **why_it_matters:** §4.11: семантика токенов; смена толщины полосы баннера ошибки неожиданно поменяет таблицу.
- **evidence:** `own: { borderLeftWidth: stroke.bannerError, paddingLeft: space.s2 }`, `{ borderLeftColor: theme.text.accent }`
- **recommended_fix:** нейтральный stroke-токен (`stroke.indicator`/аналог) и роль border/accent, если есть; иначе — завести в системе.

### [LOW] Фокус на заголовок подтверждения отмены не переводится
- **file:** apps/app/src/features/races/participation/withdraw-confirm.tsx
- **location:** стр. 21–27
- **problem:** §7.4 «фокус — на заголовок подтверждения»: у заголовка только `accessibilityRole="header"` + `accessibilityLabel`, фокус
  скринридера (`AccessibilityInfo.setAccessibilityFocus` / `focus()` на web) не переносится — после нажатия фокус остаётся на исчезнувшей кнопке.
- **why_it_matters:** доступность (VoiceOver/TalkBack теряют контекст); не блокер.
- **evidence:** нет вызова установки фокуса в `WithdrawConfirm`.
- **recommended_fix:** ref на заголовок и перенос фокуса в `useEffect` при монтировании (или зафиксировать в spec, что достаточно header-роли).

## Вердикт

APPROVE — CRITICAL/HIGH нет. Рекомендуется закрыть оба MEDIUM до merge (гонка кеша мутация/опрос и потеря текста отказа отмены,
с честным тестом на ответ сервера после 409).

# Fix pass 1

coder, коммит `72c7f2e` («Результаты, слайс 04: исправления ревью pass 1»). TDD: каждый тест ниже сначала был красным.

| Находка | Статус | Что сделано | Тест |
|---|---|---|---|
| MEDIUM — устаревший опрос затирает ответ мутации | FIXED | `useEntryMutation`: `onMutate` — `cancelQueries(raceEntryKey(id))`; `applyEntry` — повторный `await cancelQueries` перед `setQueryData` | `race-participation.test.tsx` «ответ опроса, начатого до мутации, не затирает ответ мутации»: опрос висит, отмена участия, затем приходит устаревший ответ — блок остаётся «Участие отменено» (без исправления падал) |
| MEDIUM — ошибка отмены пропадает после перезапроса | FIXED | мутация отмены перенесена в `EntryActions`; баннер отказа — вне ветки `canWithdraw`; `WithdrawConfirm` теперь `{ pending, onConfirm, onClose }` | «409 RACE_WITHDRAW_CLOSED — текст остаётся и после перезапроса с canWithdraw: false»: перезапрос отдаёт `['window_closed','upload_closed']`, текст отказа виден, панели нет |
| LOW — прогресс пропадает при `canAddAttempt: false` | FIXED | `UploadProgress` рисуется при `phase === 'uploading'` независимо от `canAddAttempt` | «срок загрузки истёк посреди отправки — прогресс и «Отменить» остаются» |
| LOW — `unknown` перебивает свою причину | FIXED | `firstReason`: сначала причина своего подмножества, `unknown` — только если своей нет | `participation-format.test.ts` «[unknown, upload_closed] → upload_closed» (+ заявка) |
| LOW — фокус на заголовок подтверждения | FIXED | `src/lib/accessibility-focus(.web).ts`: native — `AccessibilityInfo.sendAccessibilityEvent(ref, 'focus')`, web — `tabindex=-1` + `focus()`; вызов в `useEffect` панели | «подтверждение — фокус скринридера на заголовок»; `accessibility-focus.web.test.ts` (2) |
| LOW — полоса своей строки | FIXED частично | ширина — `stroke.indicator` (вместо `stroke.bannerError`), цвет — роль рамки `border.strong` (вместо `text.accent`); `minWidth: space.s6` колонки места убран. Акцентной роли рамки в системе нет — «Вы» отмечено текстом (accent — только для текста); акцентная рамка — кандидат в app-foundation | ожидания `race-results.test.tsx` не менялись (зелёные) |

**Проверки**

- `npx jest` (apps/app) → `Test Suites: 94 passed, 94 total`, `Tests: 822 passed, 822 total`; `npx tsc --noEmit` — exit 0; `eslint apps/app/src` — без ошибок.
- `TURBO_CONCURRENCY=1 pnpm check` (Node 24.22.1, `MONGO_URL_TEST=…/pokatim_r04ui_test`, `REDIS_URL_TEST=…/11`) → exit 0:
  `Tasks: 13 successful, 13 total` (`Cached: 12`), `@pokatim/app:test: Test Suites: 94 passed`, `Tests: 822 passed, 822 total`.
- `E2E_API=1 pnpm e2e:web`, ручная проверка на симуляторах и в браузере — NOT VERIFIED.
