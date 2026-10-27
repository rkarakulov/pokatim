# Findings — app-themes D1 (contracts + API + admin) — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..9a070c6 (1 commit; working tree clean)
verdict: APPROVE

## Проверено (без находок)

- **Безопасность / права:** `AppearanceAdminController` — `@UseGuards(PanelGuard)` + `@RequirePermission('appearance.manage')`
  на классе; право только у `admin` (`ROLE_PERMISSIONS.admin = PERMISSIONS`, moderator/organizer — явные списки без него);
  сторож `admin-routes.test.ts` дополнен. Int-тест: moderator/organizer → 403 на GET и PUT, без сессии → 401.
  CSRF для `PUT` — глобальный `enableCsrfProtection` (`http-app.ts`), CORS уже разрешает `PUT`.
- **Публичный эндпоинт:** `PublicReadGuard` + `PUBLIC_READ_CACHE_CONTROL` (как `calendar`), ответ ровно `{ themeId }`,
  без `set-cookie` (тест). Глобального auth-гарда нет — эндпоинт публичен намеренно.
- **Валидация / NoSQL:** `UpdateAppearanceRequest` — `strictObject`, закрытый enum, `Version`; в фильтр
  `findOneAndUpdate` идут только `_id`-константа и число после zod. Тест 400 на `{ $ne: null }` в обоих полях,
  лишний ключ, −1, 1.5, отсутствие версии.
- **Транзакция / оптимистичная блокировка:** чтение, проверка версии, запись и `PanelAudit.append` — в одном
  `transactions.run`; колбэк без побочных эффектов (лог — после коммита). Первая запись — `insertOne` с обработкой
  дубликата `_id_` → 409; гонка двух транзакций разрешается write conflict → повтор → проверка версии → 409.
  Int-тест AC4 (вставка и обновление параллельно: ровно одна 200, одна 409, одна запись журнала) — зелёный.
- **Аудит:** append-only через `PanelAudit.append(tx, …)`, `subject.kind = 'platform'`, nil UUID проходит `Uuid`
  (контрактный тест), `details.themeFrom/themeTo`; повтор той же темы и 409 — без записи (тесты). `PanelAuditReader`
  отдаёт `details` целиком — новые поля доходят до панели.
- **Append-only enum-ы:** `appearance.manage`, `appearance.theme_changed`, `platform` — в конце; снимки тестов
  обновлены только добавлением (+ снимок прав admin в `panel-session.int.test.ts`).
- **Миграция:** `0024_platform_settings` — только `ensureCollection`, последняя, идемпотентна (тест). На текущем
  `origin/develop` (3b447b7) новых миграций нет — коллизии номера (R1) нет.
- **Серверный авторитет:** клиент шлёт только намерение `{ themeId, version }`; время — `CLOCK`; в документе нет
  `userId` (порт стирания не нужен).
- **Placement:** модуль импортирует только `../panel` (index) и `../../public-read.guard`; hex в админке нет —
  палитра «Классики» из `themes.light`; `apps/app` и `packages/design-tokens` не тронуты.
- **Состояния данных (§4.12):** скелетон 7 карточек той же сетки, заголовок сразу; `ErrorState` с повтором; данные
  не прячутся при ошибке сохранения; `Button busy`. `refetchOnWindowFocus: false` глобально (`session/query-client.ts`),
  поэтому `version` под незавершённым выбором не подменяется тихо (lost update не возникает).
- **i18n:** все строки в `ru.ts`, ключи тем — шаблоном по `AppThemeId` (typecheck ловит пропуск).
- **Documentation Sync (§10):** `pokatim-{backend,db,contracts,web}.md`, `docs/product/admin-panel.md` обновлены;
  ADR-0016 сознательно отложен (по spec).
- **Прогоны (свои):** api `vitest run src/modules/appearance src/admin-routes.test.ts src/modules/panel/permissions.test.ts
  src/db/migrations` — 48/48 (Mongo `pokatim_app_themes_review_test`, Redis db 8); contracts 258/258; api-client 93/93;
  admin (appearance, CardRadioGroup, audit, layout) 38/38; `tsc --noEmit` admin и eslint затронутых файлов — чисто.
  Полный `pnpm check` и `admin build` — NOT VERIFIED мной (есть в отчёте coder, exit 0).

## Находки

### [LOW] Доступное имя радио-карточки включает всё содержимое карточки
- **file:** apps/admin/src/ui/CardRadioGroup.tsx
- **location:** `<label className="card-radio…">` вокруг `input`, заголовка и `option.children`
- **problem:** `label` оборачивает всю карточку, поэтому accessible name радио = «Атлас Превью появится позже
  Светло-серый фон, … Сейчас в приложении». Превью задумано как декоративное (`aria-hidden` на макете), но подпись
  «Превью появится позже» и описание попадают в имя.
- **why_it_matters:** скринридер зачитывает длинное имя у каждой из 7 опций при навигации стрелками; тест это
  маскирует — ищет радио по `RegExp('^Имя')`, а не по точному имени.
- **evidence:** `AppearanceScreen.test.tsx`: `screen.getByRole('radio', { name: new RegExp(\`^${name}\`) })`.
- **recommended_fix:** `aria-labelledby` на id заголовка (`card-radio__title`) и `aria-describedby` на блок
  содержимого (или `label` только вокруг головы карточки + клик по карточке); в тесте — точное имя.

### [LOW] Скелетон без `aria-busy`
- **file:** apps/admin/src/features/appearance/AppearanceScreen.tsx
- **location:** ветка загрузки, `<div className="card-radios__grid" aria-hidden="true">`
- **problem:** во время первой загрузки сетка скрыта от AT полностью, состояния «загрузка» для скринридера нет.
- **why_it_matters:** расхождение с соседними экранами (`DisputeScreen` — `aria-busy="true"` на теле, `DataTable` —
  `aria-busy`); мелкая a11y-неконсистентность.
- **evidence:** `apps/admin/src/features/disputes/DisputeScreen.tsx:170`.
- **recommended_fix:** `aria-busy="true"` на контейнере (скелетоны оставить `aria-hidden`).

### [LOW] Двусмысленная формулировка источника id тем в правиле контрактов
- **file:** .claude/rules/pokatim-contracts.md
- **location:** пункт «Тема приложения (app-themes)»
- **problem:** «единственный источник id для API и панели — реестр `appThemes` в `@pokatim/design-tokens` объявляет
  тот же состав…» читается так, будто источник — реестр design-tokens, тогда как решение F6 — источник `APP_THEME_IDS`
  контрактов.
- **why_it_matters:** правило читают агенты слайсов B/C/D2; неверное прочтение даёт зависимость не в ту сторону.
- **recommended_fix:** «`APP_THEME_IDS` — единственный источник id для API и панели; реестр `appThemes` … объявляет
  тот же состав и порядок (сторож равенства — D2)».

## Итог

CRITICAL/HIGH нет. Acceptance D1 1–8 подтверждены кодом и тестами (AC7 «7 цветных превью» — по согласованному
отклонению F1 закрывается в D2); AC9 — по отчёту coder.
