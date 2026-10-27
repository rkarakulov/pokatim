# Findings — app-themes-d1 — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..9a070c6
verdict: REQUEST CHANGES

### [HIGH] Ошибка обновления скрывается при наличии данных
- **file:** apps/admin/src/features/appearance/AppearanceScreen.tsx
- **location:** строки 59–62, 84–117
- **problem:** При ошибке повторного GET экран продолжает показывать данные без баннера ошибки и действия повтора. После 409 обработчик `reload()` дополнительно сбрасывает выбор и скрывает конфликт даже при неуспешном перечитывании.
- **why_it_matters:** Администратор видит устаревшую настройку как актуальную и теряет возможность повторить обновление. Нарушен AGENTS.md §4.12: ошибка обновления должна оставлять данные и показывать баннер с повтором.
- **evidence:** Ветка `current ? ...` не проверяет `query.isError`; `ErrorState` доступен только без данных. `reload()` безусловно вызывает `setChoice(undefined)` и `setConflict(false)`. Проверка установленного `@tanstack/query-core` подтвердила: после неуспешного обновления сохраняются `data`, а статус становится `error`. Глобальный `QueryCache.onError` обрабатывает только 401/403.
- **recommended_fix:** Добавить над сохранёнными данными баннер ошибки обновления с повтором. Сбрасывать выбор и конфликт только после успешного `refetch()`. Добавить тест «409 → Обновить → ошибка GET → повтор → успешное обновление».

### [HIGH] При открытии без сети остаётся бесконечный скелетон
- **file:** apps/admin/src/features/appearance/AppearanceScreen.tsx
- **location:** строки 117–130
- **problem:** Состояние `fetchStatus === 'paused'` учитывается только внутри ветки `query.isError`. При первой загрузке без сети запрос приостанавливается без перехода в ошибку, поэтому экран показывает скелетоны вместо «Нет соединения» с повтором.
- **why_it_matters:** Пользователь не получает объяснения и действия для восстановления загрузки. Нарушены AGENTS.md §4.12 и AC6.
- **evidence:** Проверка установленного `@tanstack/query-core` с `onlineManager.setOnline(false)` дала `isError: false`, `fetchStatus: 'paused'`, без данных. Существующий `apps/admin/src/ui/DataTable.tsx` обрабатывает этот случай условием `data === undefined && (query.isError || paused)`.
- **recommended_fix:** При отсутствии данных показывать `ErrorState`, если запрос завершился ошибкой **или** приостановлен, передавая `offline={query.fetchStatus === 'paused'}`. Добавить тест открытия экрана без сети.

Проверки: состояния TanStack Query воспроизведены локально. `pnpm check`, сборка и интеграционные тесты — **NOT VERIFIED**: в рамках read-only ревью не запускались; результаты автора независимо не подтверждены.
# Findings — app-themes-d1 — pass 2 — reviewer: codex
base: origin/develop   commits: origin/develop..d7e3ec2
verdict: APPROVE

### [MEDIUM] Потерянное обновление: незавершённый выбор уходит с версией обновлённых данных
- **file:** apps/admin/src/features/appearance/AppearanceScreen.tsx
- **problem:** Выбор хранит только `themeId`, а `PUT` берёт `version` из текущего `query.data`. Если данные
  перечитались (например, `refetchOnReconnect`) после чужой смены, незавершённый выбор отправляется с новой версией и
  перезаписывает чужое изменение без 409.
- **recommended_fix:** При первом изменении выбора запоминать исходную версию и отправлять её до успешного сохранения
  или явного сброса выбора (`reload`). Тест: выбор при версии 0 → данные обновились до версии 1 → «Сохранить»
  отправляет `version: 0` → 409 → `ConflictBanner`.
- **status:** исправлено (coder): выбор — `{ themeId, baseVersion }`, тест в `AppearanceScreen.test.tsx`.

(Копия находки pass 2 записана coder-ом по сообщению оркестратора.)
