# Слайс D1 — тема приложения: контракты, API, админка

Часть задачи `task.md` этой папки (раздел 3 «Слайс D» — только contracts + api + admin). Отдельный PR в `develop`,
ветка `feature/app-themes-d1` от `origin/develop`. Реализуется параллельно со слайсами A–C: **не трогает** `apps/app`,
`apps/app/server` и `packages/design-tokens` (только читает уже существующие экспорты `@pokatim/design-tokens`).
Часть «app / app server» (useAppearanceQuery, SecureStore, SSR-middleware) и подключение превью к реестру тем — слайс
D2 (после B и C). Уровень — task3 (контракты, миграция, права, аудит).

## Architecture Review — app-themes / D1

Status: **CONCERNS** (блокеров нет; находки 8.1 решены рекомендациями ниже — coder идёт по ним, отклонения от
`task.md` записаны в 8.2).

## 5. Architecture Context

- **Приложения / пакеты:** `packages/contracts`, `packages/api-client`, `packages/i18n`, `apps/api` (новый модуль
  `appearance`, правки `panel`), `apps/admin` (новый раздел). `apps/app`, `packages/design-tokens` — нет.
- **Модуль API `appearance`** (`apps/api/src/modules/appearance/`) — глобальная настройка платформы «тема
  приложения». Слои: `appearance-public.controller.ts` (публичное чтение) и `appearance-admin.controller.ts` (панель)
  → `appearance.service.ts` → `appearance.repository.ts` → `appearance.collection.ts`. Импортирует только
  `modules/panel/index.ts` (`PanelModule`, `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit`) и
  `src/public-read.guard.ts`. Других модулей не читает, его никто не импортирует (index экспортирует только модуль).
- **Эндпоинты** (глобальный префикс `v1` ставит `configureHttp` → `configureHttpApp(app, { prefix: API_VERSION })`,
  в `@Controller` префикса нет):

  | Метод и путь | Контроллер | Гард | Ответ |
  |---|---|---|---|
  | `GET /v1/appearance` | `@Controller('appearance')` | `PublicReadGuard` (IP-лимит `public-read`) | `200 AppAppearance`, `Cache-Control: public, max-age=60` (`PUBLIC_READ_CACHE_CONTROL`) |
  | `GET /v1/admin/appearance` | `@Controller('admin/appearance')` | `PanelGuard` + `@RequirePermission('appearance.manage')` (на классе) | `200 PanelAppearance`, `no-store` (ставит гард) |
  | `PUT /v1/admin/appearance` | тот же | тот же | `200 PanelAppearance`; `409 CONFLICT`; `400 VALIDATION_FAILED`; `403 FORBIDDEN`; `401 UNAUTHORIZED` |

- **Контракты:** новый файл `src/appearance/appearance.schema.ts`; правки `admin/permissions.schema.ts` (право в
  конец), `admin/audit.schema.ts` (действие, вид объекта — в конец; детали `themeFrom`/`themeTo`). Совместимость: всё
  аддитивно; публичный ответ — `tolerantEnum` (будущая 8-я тема у старой сборки → `'unknown'` → «Классика»).
- **Данные:** коллекция `platform_settings`, документ `{ _id: 'appearance', themeId, version, updatedAt }`; нет
  документа — `classic`, `version: 0`, `updatedAt: null`. Миграция `0024_platform_settings` — только
  `ensureCollection` (индексов, кроме `_id`, нет; seed нет — см. 8.1 F5). Expand-only.
- **Очереди / outbox:** нет. Смена темы — не доменное событие для других модулей; приложение узнаёт о ней опросом
  публичного GET (T2). Журнал — `PanelAudit.append` в транзакции действия.
- **Серверный авторитет:** клиент присылает намерение (`themeId` из закрытого списка + ожидаемая `version`); сервер
  проверяет право, версию и пишет журнал. Приложение тему не выбирает (T1).

## 5.1 Placement & Reuse Gate

**Переиспользуем (без копий):**

- `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL` — `apps/api/src/public-read.guard.ts`.
- `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelPrincipal`, `PanelAudit`, `PanelModule` —
  `apps/api/src/modules/panel/index.ts`.
- `MongoTransactions`, `DbSession` — `apps/api/src/db`; `domainError` — `apps/api/src/error-messages.ts`;
  `CLOCK` — `@rkarakulov/api-kit/core`; `isDuplicateKey` — `@rkarakulov/api-kit/mongo`; `ensureCollection` —
  `db/migrations/0002_identity.ts`; `ZodValidationPipe` — `@rkarakulov/api-kit/core`.
- Контракты: `Version`, `fieldError`, `tolerantEnum`, `FieldErrorCode` — `packages/contracts/src/common.ts`; базовый
  код `CONFLICT` (новых кодов ошибок **нет**).
- api-client: `createAdminApiClient` (`packages/api-client/src/admin.ts`), публичный `getPublic` в
  `packages/api-client/src/index.ts`.
- admin: `PageHeader`, `Button`, `Banner`, `ConflictBanner`, `ErrorState`, `.skeleton`, `RequirePermission`
  (`router.tsx`), `useCan`/`Can` (`session/can.tsx`), `isForbidden` (`session/errors`), `NAVIGATION`.
- Образцы: модуль `calendar` (контроллеры, `current()` + `findOneAndUpdate` по `version`, аудит в транзакции),
  `features/calendar/*` (409 → `ConflictBanner`, инвалидация ключей).
- Палитра «Классики» для превью — существующий `themes.light` из `@pokatim/design-tokens` (только чтение).

**Новое (обосновано):**

- `apps/admin/src/ui/CardRadioGroup.tsx` — радиогруппа карточек с произвольным содержимым (у `RadioGroup` подпись
  только строкой). Без доменных импортов (правило `src/ui`), кандидат в `admin-kit` как остальные.
- Пакетов не добавляем (потребитель реестра id — contracts уже общий).

**Запрещено:**

- hex и копии значений палитр в `apps/admin` (ESLint, `AGENTS.md` §4.11) и в `packages/contracts` (контракт — форма
  данных, не оформление). Палитры тем — только `@pokatim/design-tokens` (слайсы B/C), в D1 — шов `theme-previews.ts`.
- Второй список id тем в admin/api: единственный источник — `APP_THEME_IDS` контрактов.
- Свой гард/лимит публичного чтения, ручной `Cache-Control`-строкой, ручной fetch в админке, `createIndex` в коде.
- `updatedByUserId` в документе настройки (кто менял — только журнал; иначе нужен порт стирания аккаунта).

## 6. Relevant Files

| Путь | Роль |
|---|---|
| `apps/api/src/modules/calendar/calendar-admin.controller.ts`, `calendar-public.controller.ts`, `calendar.service.ts`, `calendar.repository.ts` | образец контроллеров, версии, аудита |
| `apps/api/src/modules/panel/permissions.ts`, `panel.collection.ts` (`AuditDetailsDoc`), `index.ts` | права, детали журнала |
| `apps/api/src/public-read.guard.ts` | гард и кэш публичного чтения |
| `apps/api/src/app.module.ts` | регистрация модуля |
| `apps/api/src/admin-routes.test.ts` | сторож `/v1/admin/*` под `PanelGuard` |
| `apps/api/src/db/migrations/{index.ts,0008_calendar.ts,migrations.int.test.ts}` | миграции |
| `packages/contracts/src/admin/{permissions,audit}.schema.ts` (+ тесты) | enum-ы только в конец |
| `packages/api-client/src/{index,admin}.ts` | клиенты |
| `apps/admin/src/{navigation.ts,router.tsx,layout/AppLayout.test.tsx}` | раздел и навигация |
| `apps/admin/src/features/audit/AuditScreen.tsx` | показ деталей смены темы |
| `apps/admin/src/ui/{RadioGroup.tsx,ConflictBanner.tsx,index.ts}`, `apps/admin/src/index.css` | UI-кирпичи |
| `packages/i18n/src/ru.ts` | строки |

## 7. Implementation Notes

### Контракты — `packages/contracts/src/appearance/appearance.schema.ts`

```ts
/** Темы приложения (app-themes). Только в конец; порядок = порядок карточек в панели. */
export const APP_THEME_IDS = ['classic', 'atlas', 'chrono', 'planner', 'journal', 'navigation', 'typography'] as const;
export const AppThemeId = z.enum(APP_THEME_IDS, { error: fieldError('INVALID') });
export type AppThemeId = z.infer<typeof AppThemeId>;
/** Тема по умолчанию: нет настройки, незнакомый id, нет сети. */
export const DEFAULT_APP_THEME_ID = 'classic' satisfies AppThemeId;

/** `GET /v1/appearance` — ответ приложения: только тема; незнакомая — 'unknown' (клиент → «Классика»). */
export const AppAppearance = z.object({ themeId: tolerantEnum(APP_THEME_IDS) });

/** `GET|PUT /v1/admin/appearance` — панель (строгий enum, панель деплоится с API). */
export const PanelAppearance = z.object({
  themeId: AppThemeId,
  version: Version,
  /** null — настройку ещё не меняли (действует «Классика»). */
  updatedAt: z.iso.datetime().nullable(),
});

/** `PUT /v1/admin/appearance` — намерение: тема из списка + ожидаемая версия. Лишние ключи — 400. */
export const UpdateAppearanceRequest = z.strictObject({ themeId: AppThemeId, version: Version });
```

Экспорт — `export * from './appearance/appearance.schema.ts'` в `src/index.ts`. Имена — по конвенции пакета
(PascalCase-схема = тип), а не `appThemeIdSchema`/`appearanceSchema` из `task.md` (8.2).

- `admin/permissions.schema.ts`: `'appearance.manage'` в конец `PERMISSIONS` с комментарием `// app-themes: тема
  приложения райдера (только admin)`.
- `admin/audit.schema.ts`: `'appearance.theme_changed'` в конец `AUDIT_ACTIONS`; `'platform'` в конец
  `AUDIT_SUBJECT_KINDS` (комментарий: `id` — `PLATFORM_SUBJECT_ID`, см. 8.1 F3); в `AuditEntry.details` —
  `themeFrom: AppThemeId.optional()`, `themeTo: AppThemeId.optional()` (импорт из `../appearance/appearance.schema.ts`).

### API — `apps/api/src/modules/appearance/`

- `appearance.collection.ts`: `APPEARANCE_COLLECTIONS = { settings: 'platform_settings' } as const`;
  `APPEARANCE_SETTINGS_ID = 'appearance' as const`; `interface AppearanceSettingsDoc { _id: 'appearance'; themeId:
  AppThemeId; version: number; updatedAt: Date }`; `appearanceCollections(db)`. JSDoc: создаёт миграция
  `0024_platform_settings`; единственный писатель документа `appearance` — `AppearanceRepository`; другие документы
  `platform_settings` — только своими `_id` и своими репозиториями.
- `appearance.repository.ts`: `find(session?)` по `_id`; `insert(tx, doc)` (дубликат `_id_` → вернуть `false`, не
  бросать; `isDuplicateKey(error, '_id_')`); `update(tx, expectedVersion, set)` — `findOneAndUpdate({ _id:
  'appearance', version: expectedVersion }, { $set, $inc: { version: 1 } }, { returnDocument: 'after', session })`
  → документ или `null`. `{ session }` — в каждой операции. Фильтры — только примитивы после zod.
- `appearance.service.ts` (`AppearanceService`; `CLOCK`, `MongoTransactions`, `PanelAudit`):
  - `getPublic(): Promise<AppAppearance>` — `{ themeId: doc?.themeId ?? 'classic' }` (ровно один ключ);
  - `getPanel(): Promise<PanelAppearance>` — нет документа → `{ themeId: 'classic', version: 0, updatedAt: null }`;
  - `update(actorUserId, { themeId, version })` — одна транзакция:
    1. `current = find(tx)`; `currentVersion = current?.version ?? 0`; `currentTheme = current?.themeId ?? 'classic'`;
    2. `version !== currentVersion` → `domainError('CONFLICT', 409)` (раньше проверки «та же тема»);
    3. `themeId === currentTheme` → вернуть текущее без записи и без журнала (идемпотентный повтор);
    4. нет документа → `insert({ _id, themeId, version: 1, updatedAt: now })`; `false` (вставили параллельно) → 409;
       есть → `update(tx, version, { themeId, updatedAt: now })`; `null` → 409;
    5. `PanelAudit.append(tx, { action: 'appearance.theme_changed', actor: { kind: 'user', userId }, subject: {
       kind: 'platform', id: PLATFORM_SUBJECT_ID, label: 'Оформление приложения' }, details: { themeFrom:
       currentTheme, themeTo: themeId } })`. Причины нет (действие обратимо, не деструктивно).
  - `PLATFORM_SUBJECT_ID = '00000000-0000-0000-0000-000000000000'` — константа сервиса (nil UUID проходит `Uuid`
    контрактов — проверено `z.uuid()`); экспортировать не нужно.
  - Колбэк транзакции без побочных эффектов (повторяется); лог — после коммита, без лишнего (`theme from→to`).
- Контроллеры — тонкие, по образцу календаря: тело — `new ZodValidationPipe(UpdateAppearanceRequest,
  FieldErrorCode)` (неизвестный `themeId` → `400 VALIDATION_FAILED { fields: [{ path: 'themeId', code: 'INVALID' }]
  }`); `@Put()` + `@HttpCode(200)`; `@CurrentPanelUser() actor`. Публичный: `@UseGuards(PublicReadGuard)` на классе,
  `@Get()` + `@Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)`.
- `appearance.module.ts`: `imports: [PanelModule]`, `controllers: [AppearanceAdminController,
  AppearancePublicController]`, `providers: [AppearanceRepository, AppearanceService, PublicReadGuard]`; `index.ts` —
  `export { AppearanceModule }`. Регистрация в `AppModule` после `CalendarModule`.
- `panel/panel.collection.ts`: `AuditDetailsDoc` + `themeFrom?: AppThemeId; themeTo?: AppThemeId`.
- `panel/permissions.ts`: `admin: PERMISSIONS` уже включает новое право; moderator/organizer не меняются; дополнить
  JSDoc карты строкой «app-themes: `appearance.manage` — только admin».
- Миграция `apps/api/src/db/migrations/0024_platform_settings.ts`: `export const platformSettings: MongoMigration =
  { id: '0024_platform_settings', up: (db) => ensureCollection(db, APPEARANCE_COLLECTIONS.settings) }` — в конец
  `migrations`. Индексов и seed нет.

### api-client

- `index.ts` (публичный клиент приложения): `getAppearance: () => getPublic('/v1/appearance', AppAppearance)` —
  потребитель появится в D2; добавляем сейчас (contracts-first, клиент тестируется).
- `admin.ts`: хелпер `put` рядом с `post` (`method: 'PUT'`, `credentials: 'same-origin'`);
  `getAppearance: () => get('/v1/admin/appearance', PanelAppearance)`,
  `updateAppearance: (body: UpdateAppearanceRequest) => put('/v1/admin/appearance', PanelAppearance, body)`.

### admin — раздел «Оформление приложения»

- `navigation.ts`: `to` + `'/appearance'`; пункт `{ to: '/appearance', labelKey: 'admin.nav.appearance',
  permission: 'appearance.manage', group: 'bottom' }` — **в конец массива** (после «Модерации райдов»).
- `router.tsx`: `appearanceRoute` (`path: 'appearance'`) под `<RequirePermission permission="appearance.manage">`.
- `features/appearance/AppearanceScreen.tsx`:
  - запрос `['admin', 'appearance']` → `api.getAppearance()`; первая загрузка — 7 карточек-скелетонов (`.skeleton`)
    той же сетки, заголовок виден сразу; ошибка без данных — `ErrorState` с повтором; 403 — глобальный обработчик.
  - Выбор — локальный `useState<AppThemeId>` (инициализация из ответа; форма из одного поля — как исключение
    `DecisionPanel`, react-hook-form не нужен; тело проверяет сервер). Карточки — `CardRadioGroup` по
    `APP_THEME_IDS`; текущая сохранённая — бейдж «Сейчас в приложении».
  - «Сохранить» (`Button`, `busy` на время мутации) активна, только если выбор ≠ сохранённой теме; мутация шлёт
    `{ themeId, version }` из последнего ответа. Успех: `setQueryData(['admin','appearance'], ответ)`, инвалидация
    `['admin','audit']`, `Banner tone="success" role="status"` «Тема сохранена. Приложение применит её в течение
    минуты». `409 CONFLICT` → `ConflictBanner`; «Обновить» — `refetch()` и сброс выбора к серверному значению.
    Прочая ошибка — `Banner` ошибки над кнопкой, выбор сохраняется.
  - Подсказка под заголовком: тема меняется для всех райдеров; панель «Протокол» остаётся в своей теме (T6).
- `features/appearance/ThemePreview.tsx` — мини-макет (без доменной логики, `aria-hidden`; смысл несёт подпись
  карточки): фон, карточка с заголовком-плашкой, акцентная кнопка-плашка, линия маршрута (SVG-полилиния фиксированной
  формы, `stroke` — из палитры). Цвета — CSS-переменные `--preview-canvas`, `--preview-card`, `--preview-text`,
  `--preview-accent`, `--preview-route` через `style` (значения — из импортированных токенов, не литералы; CSP
  панели — `style-src 'unsafe-inline'`, ок). Без палитры (`null`) — нейтральный макет на переменных `panel`
  (`--color-surface-*`, `--color-border-*`) и подпись «Превью появится позже».
- `features/appearance/theme-previews.ts` — **шов** превью (решение 8.1 F1):
  `export interface ThemePreviewPalette { canvas: string; card: string; text: string; accent: string; route: string }`;
  `export const THEME_PREVIEWS: Record<AppThemeId, ThemePreviewPalette | null>` — `classic` из `themes.light`
  (`surface.raised`, `surface.default`, `text.primary`, `text.accent`, `map.route`), остальные шесть — `null` с
  `TODO(app-themes D2)`. В D2 модуль строится из реестра `appThemes` (`previewOf(def)`), `null`-ветка удаляется.
- `ui/CardRadioGroup.tsx` — `fieldset` + `legend` + нативные `input[type=radio]` (стрелки/Tab — браузера), каждая
  опция — `label` с `children: ReactNode`; выбранная — класс-модификатор и `:focus-visible` из переменных. Экспорт в
  `ui/index.ts`. Стили — `index.css`, только переменные дизайн-системы и `--panel-*`.
- `features/audit/AuditScreen.tsx` → `details()`: при `themeFrom && themeTo` — `t('admin.audit.themeChange', { from:
  t(\`admin.appearance.theme.${from}.name\`), to: … })`. Подпись объекта — `subject.label` (уже работает).

### i18n — `packages/i18n/src/ru.ts` (блок `// app-themes D1` в конец admin-ключей)

`admin.nav.appearance` «Оформление приложения»; `admin.appearance.title` «Оформление приложения»;
`admin.appearance.hint` «Тема меняется у всех райдеров в приложении и на сайте. Панель «Протокол» остаётся в своей
теме.»; `admin.appearance.legend` «Тема приложения»; `admin.appearance.current` «Сейчас в приложении»;
`admin.appearance.save` «Сохранить»; `admin.appearance.saved` «Тема сохранена. Приложение применит её в течение
минуты.»; `admin.appearance.saveFailed` «Не удалось сохранить тему»; `admin.appearance.previewPending` «Превью
появится позже»; `admin.appearance.theme.<id>.name` ×7 («Классика», «Атлас», «Хронометр», «Планировщик», «Журнал»,
«Навигация», «Типографика»); `admin.appearance.theme.<id>.description` ×7 (одна строка характера темы из таблицы
слайса C, своими словами; «Хронометр» и «Навигация» — с пометкой «всегда тёмная»);
`admin.audit.action.appearance.theme_changed` «Тема приложения изменена»; `admin.audit.themeChange` «{from} →
{to}». Ключи тем — шаблоном по `AppThemeId` (пропуск — ошибка typecheck).

## 8. Risks / Assumptions / Open Questions

- R1. Номер миграции `0024` может занять параллельная ветка — проверить при обновлении от `develop` перед merge;
  при коллизии — следующий номер (применённую не переименовывать).
- R2. До слайса C админ может выбрать тему, которой в приложении ещё нет: приложение (D2) обязано падать в
  «Классику» по незнакомому/неподдержанному id. На `develop` это безопасно; в прод D1 без B–D2 не выкатывается.
- R3. Кэш 60 с: после сохранения приложение меняет тему с задержкой до ~минуты (T2) — подсказка в успехе.
- A1. `version` — счётчик документа настройки; без документа — 0.

## 8.1 Requirements Consistency

- **F1. Недоопределено / зависимость:** превью «из токенов темы» (task.md §3 D) требует палитр 6 тем, которые
  появляются только в слайсе C, а D1 должен идти параллельно и не трогать `design-tokens`.
  Альтернативы: (a) превью из реестра `appThemes` — D1 ждёт B и C; (b) локальное описание 7 палитр в админке или
  контрактах — hex в приложении запрещён (§4.11, ESLint), палитры в контрактах — не форма данных, второй источник
  правды разойдётся с C; (c) **шов `theme-previews.ts`**: компонент превью принимает палитру-пропсы, «Классика» —
  из уже существующего `themes.light`, остальные — нейтральный макет до D2, где шов переключается на `appThemes`.
  **Рекомендация — (c):** параллельность сохраняется, дублей и hex нет, переделка в D2 — один модуль.
  Следствие: AC7 `task.md` («7 превью» с цветами) закрывается в D2; в D1 — 7 карточек, цветное превью у «Классики».
- **F2. Конфликт с правилом контрактов:** `appearanceSchema { themeId, version, updatedAt }` как общий ответ vs
  `pokatim-contracts.md` (enum-ы ответов приложения — `tolerantEnum`; публичное чтение — без служебных полей).
  Строгий enum в ответе приложения уронит разбор у старых сборок после добавления 8-й темы. **Решение:** два ответа —
  `AppAppearance { themeId: tolerantEnum }` (публичный) и `PanelAppearance { themeId, version, updatedAt }` (панель).
- **F3. Конфликт с кодом:** `AuditSubject.id` — `Uuid` (`packages/contracts/src/admin/audit.schema.ts`), а у
  «платформы» нет UUID (`_id: 'appearance'`). Альтернативы: (a) **фиксированный nil UUID `PLATFORM_SUBJECT_ID`**;
  (b) ослабить `AuditSubject.id` до строки — меняет общий контракт журнала и фильтр `subjectId`; (c) `subject: null`
  и только детали — расходится с решением «subject kind `platform`». **Рекомендация — (a).**
- **F4. Конвенция:** `PUT` vs панель, где все мутации — `POST` (в `admin.ts` нет `put`). Настройка — синглтон,
  замена целиком идемпотентна — `PUT` корректен семантически и задан в `task.md`; цена — хелпер `put` в
  api-client. **Решение:** `PUT` по spec, хелпер `put` с тестом. Альтернатива `POST /v1/admin/appearance` —
  допустима, если человек предпочтёт единообразие.
- **F5. Недоопределено:** seed документа в миграции. Seed не нужен: код обязан обрабатывать отсутствие документа
  (тестовый стенд очищает коллекции перед тестом), а seed дал бы второй путь «первой записи». **Решение:** без seed;
  первая смена — `insertOne` с защитой от гонки (дубликат `_id` → 409).
- **F6. Два списка id тем:** `APP_THEME_IDS` (контракты, D1) и `AppThemeId` реестра `appThemes`
  (`@pokatim/design-tokens`, слайс B). `design-tokens` от контрактов не зависит и зависеть не должен. **Решение:**
  источник списка для API и панели — контракты; слайс B объявляет тот же состав и порядок; сторож равенства
  (`Object.keys(appThemes)` = `APP_THEME_IDS`) — тест в D2 (потребитель обоих). Передать слайсу B как требование.
- **F7. Шрифт в превью:** настоящий шрифт каждой темы в админке = ещё 6 семейств в бандле панели (`font-src 'self'`,
  `@fontsource/*`). В D1 шрифт превью — шрифт панели; показ гарнитуры — решение D2 (вопрос человеку там, не здесь).
- **F8. Подтверждение смены:** смена темы обратима и не деструктивна → без `ReasonDialog` и без причины в журнале
  (`web.md`: модалка с причиной — для деструктивных). Если человек хочет подтверждение «Сменить тему у всех
  райдеров?» — `Dialog` без причины, правка в один компонент.

## 8.2 Deviations from spec

| Отклонение | Причина | Где |
|---|---|---|
| Имена схем `AppThemeId`, `AppAppearance`, `PanelAppearance`, `UpdateAppearanceRequest` вместо `appThemeIdSchema` / `appearanceSchema` / `updateAppearanceSchema` | конвенция пакета contracts | 7 |
| Публичный ответ — только `themeId` (`tolerantEnum`) | F2 | 7, 8.1 |
| Цветное превью 6 новых тем — в D2 | F1 | 8.1 |
| `subject.id` платформы — nil UUID | F3 | 7 |

Принято architect-ом 2026-10-27, подтверждение — человеком при утверждении D1.

## 8.3 Security checklist

Затронуты: роли (новое право), публичное чтение без входа, `modules/panel/**`, `apps/api/src/db/**` (миграция).

1. **AuthN/AuthZ:** `GET /v1/appearance` — без входа намеренно (настройка одинакова для всех, не персональна).
   `/v1/admin/appearance` — `PanelGuard` (cookie панели, живая сессия, активный член команды) + право
   `appearance.manage` только у роли `admin` (`ROLE_PERMISSIONS`); moderator/organizer → 403, без сессии → 401.
   UI-скрытие пункта — только отображение. Сторож — `admin-routes.test.ts`.
2. **Входные данные:** тело — `UpdateAppearanceRequest` (`strictObject`, закрытый enum, `Version` ≥ 0, целое);
   лишние ключи и операторы (`{ $ne: null }`) → 400; в фильтр БД — только примитивы после zod.
3. **Данные наружу:** публичный ответ — ровно `{ themeId }` (без версии, времени, автора); панель — без `userId`
   автора. Журнал — без e-mail/IP/UA (как весь `panel_audit`).
4. **Злоупотребления:** публичный GET — IP-лимит `public-read` (300/мин, 429 + `Retry-After`) и кэш 60 с; запись —
   только admin, отдельный лимит не нужен.
5. **Секреты и логи:** секретов нет; лог после коммита — только `from→to`.
6. **Аудит:** каждая фактическая смена — одна append-only запись `appearance.theme_changed` (кто, когда, `from→to`)
   в транзакции действия; повтор той же темы и 409 — без записи.

## 9. Acceptance Criteria (D1)

1. `GET /v1/appearance` без авторизации: `200 { themeId }` (ровно один ключ), `Cache-Control: public, max-age=60`;
   без документа — `classic`; после смены — новая тема.
2. `GET /v1/admin/appearance`: admin — `200 { themeId, version, updatedAt }` (без документа — `classic`, `0`,
   `null`), `Cache-Control: no-store`; moderator, organizer — 403; без сессии — 401.
3. `PUT /v1/admin/appearance`: верная версия — 200, `version + 1`, одна запись журнала `appearance.theme_changed`
   (`subject.kind = 'platform'`, `details.themeFrom/themeTo`, actor — сотрудник); устаревшая версия — `409
   CONFLICT`, документ и журнал без изменений; неизвестный `themeId`, лишний ключ, отрицательная/дробная/объектная
   версия — 400 без записи; та же тема с верной версией — 200 без записи и журнала; moderator/organizer — 403.
4. Две параллельные `PUT` с `version: 0` — ровно одна 200, вторая 409, одна запись журнала.
5. Контракты: `appearance.manage` — последний в `PERMISSIONS`; `appearance.theme_changed` и `platform` — последние
   в своих enum-ах; снимки тестов обновлены только добавлением.
6. Админка: пункт «Оформление приложения» (группа `bottom`, последний) виден только с `appearance.manage`; прямой URL
   без права — «Нет доступа к разделу»; 7 карточек в порядке `APP_THEME_IDS`, текущая отмечена; «Сохранить»
   неактивна без изменений; 409 — `ConflictBanner`, «Обновить» сбрасывает выбор; скелетон и ошибка — по §4.12;
   админка остаётся в теме `panel`.
7. Журнал действий показывает «Тема приложения изменена: Классика → Атлас» и объект «Оформление приложения».
8. Архитектура: модуль `appearance` импортирует только `panel/index.ts` и `public-read.guard.ts`; нет hex/палитр в
   `apps/admin` и `packages/contracts`; нет изменений в `apps/app`, `packages/design-tokens`; миграция — только
   `ensureCollection`.
9. `TURBO_CONCURRENCY=1 pnpm check` зелёный; `pnpm --filter @pokatim/admin build` зелёный.

## 9.1 Test matrix

| Уровень | Файл | Что проверяет |
|---|---|---|
| contracts unit | `packages/contracts/src/appearance/appearance.schema.test.ts` | порядок `APP_THEME_IDS` (снимок); `UpdateAppearanceRequest`: 7 валидных id, неизвестный id → `INVALID`, лишний ключ, `version` −1/1.5/строка/`{ $ne }`; `AppAppearance`: незнакомый id → `'unknown'`; `PanelAppearance`: `updatedAt: null` |
| contracts unit | `admin/permissions.schema.test.ts`, `admin/audit.schema.test.ts` | снимки enum-ов + новые значения в конце; `AuditEntry` с `subject.kind = 'platform'`, nil UUID и `themeFrom/themeTo`; неизвестная тема в деталях → ошибка |
| api unit | `modules/panel/permissions.test.ts` | `appearance.manage` — только admin; `permissionsOf` moderator/organizer не изменились |
| api сторож | `admin-routes.test.ts` | `AppearanceAdminController` в списке, все маршруты под `PanelGuard`, без `@Public` |
| api int (MongoDB) | `modules/appearance/appearance-public.int.test.ts` | AC1: без входа, кэш-заголовок, ключи ответа, нет `set-cookie`; после смены через панель — новая тема |
| api int (MongoDB) | `modules/appearance/appearance-admin.int.test.ts` | AC2–AC4: 401/403 (moderator, organizer) на GET и PUT; дефолт; смена + журнал (`panel_audit` — action, subject, details, actor); 409 устаревшей версии без записи; 400 (id, лишний ключ, операторы) без записи; та же тема — без журнала; параллельные PUT — одна 200, одна 409, одна запись; `no-store` |
| api int | `db/migrations/migrations.int.test.ts` | `0024_platform_settings` — последняя, сразу после `0023`; коллекция есть; повторный `up` без ошибки (тест `0023` больше не утверждает «последняя») |
| api-client unit | `packages/api-client/src/admin.test.ts`, `index.test.ts` | `updateAppearance` — `PUT`, тело, `same-origin`, разбор `PanelAppearance`; `getAppearance` (панель и публичный) — путь и схема |
| admin component | `features/appearance/AppearanceScreen.test.tsx` | скелетон → 7 карточек по порядку, текущая отмечена; «Сохранить» неактивна без изменений; выбор + сохранение шлёт `{ themeId, version }`, успех-баннер, инвалидация журнала; 409 → `ConflictBanner`, «Обновить» перечитывает и сбрасывает выбор; ошибка загрузки — повтор; клавиатура (стрелки по радио) |
| admin component | `ui/CardRadioGroup.test.tsx` | `legend`, нативные радио, `checked`, `onChange`, фокус |
| admin component | `layout/AppLayout.test.tsx` | порядок пунктов: «Оформление приложения» в конце `bottom` у admin; у moderator — нет |
| admin component | `features/audit/AuditScreen.test.tsx` | строка «Тема приложения изменена: Классика → Атлас», объект «Оформление приложения» |
| e2e | — | не требуется в D1 (смоук dev «смена темы → приложение» — AC8 общей задачи, после D2) |

## 10. Documentation Impact

- `.claude/rules/pokatim-backend.md` — модуль `appearance` в списке контекстов; публичное чтение `/v1/appearance`.
- `.claude/rules/pokatim-db.md` — `platform_settings` (`_id: 'appearance'`, нет документа — `classic`/0, версия,
  единственный писатель), миграция `0024_platform_settings`.
- `.claude/rules/pokatim-contracts.md` — `src/appearance/appearance.schema.ts` (публичный `tolerantEnum` vs строгий
  панели, `APP_THEME_IDS` только в конец, источник id для `design-tokens` — F6).
- `.claude/rules/pokatim-web.md` — раздел «Оформление приложения», шов `theme-previews.ts`, `CardRadioGroup`.
- `docs/product/admin-panel.md` — право `appearance.manage` в таблице ролей, раздел в карте разделов, действие журнала.
- ADR-0016 «Темы приложения» — не в D1 (общий для задачи; источник темы и доставка — в нём, пишется со слайсом D2
  или финализацией задачи); D1 даёт ему факты из этого файла.

## 11. Implementation Context

ENTRY POINTS
- `apps/api/src/modules/appearance/appearance-public.controller.ts` — `GET /v1/appearance`
- `apps/api/src/modules/appearance/appearance-admin.controller.ts` — `GET|PUT /v1/admin/appearance`
- `apps/admin/src/features/appearance/AppearanceScreen.tsx` — маршрут `/appearance`

FILES TO CREATE
- `packages/contracts/src/appearance/appearance.schema.ts`, `appearance.schema.test.ts`
- `apps/api/src/modules/appearance/{appearance.collection.ts,appearance.repository.ts,appearance.service.ts,appearance-public.controller.ts,appearance-admin.controller.ts,appearance.module.ts,index.ts,appearance-public.int.test.ts,appearance-admin.int.test.ts}`
- `apps/api/src/db/migrations/0024_platform_settings.ts`
- `apps/admin/src/features/appearance/{AppearanceScreen.tsx,AppearanceScreen.test.tsx,ThemePreview.tsx,theme-previews.ts}`
- `apps/admin/src/ui/{CardRadioGroup.tsx,CardRadioGroup.test.tsx}`

FILES TO MODIFY
- `packages/contracts/src/index.ts`; `admin/permissions.schema.ts` (+test); `admin/audit.schema.ts` (+test)
- `packages/api-client/src/index.ts`, `admin.ts` (+ `index.test.ts`, `admin.test.ts`)
- `packages/i18n/src/ru.ts`
- `apps/api/src/app.module.ts`; `admin-routes.test.ts`; `modules/panel/permissions.ts` (JSDoc), `permissions.test.ts`,
  `panel.collection.ts` (`AuditDetailsDoc`); `db/migrations/index.ts`, `migrations.int.test.ts`
- `apps/admin/src/navigation.ts`, `router.tsx`, `ui/index.ts`, `index.css`, `layout/AppLayout.test.tsx`,
  `features/audit/AuditScreen.tsx` (+test)
- docs из раздела 10

FILES TO READ
- `apps/api/src/modules/calendar/*` (образец), `apps/api/src/modules/panel/{index.ts,panel-audit.ts,panel.guard.ts}`,
  `apps/api/src/public-read.guard.ts`, `apps/api/test/{harness.ts,panel.ts,races.ts}` (`staff`, `panelCall`),
  `apps/admin/src/features/calendar/{CalendarScreen.tsx,CalendarScreen.test.tsx}`, `apps/admin/src/ui/RadioGroup.tsx`,
  `packages/design-tokens/src/brand.ts` (роли `themes.light` — только чтение)

TYPES & SCHEMAS
- `APP_THEME_IDS`, `AppThemeId`, `DEFAULT_APP_THEME_ID`, `AppAppearance`, `PanelAppearance`,
  `UpdateAppearanceRequest`; `Permission` + `'appearance.manage'`; `AuditAction` + `'appearance.theme_changed'`;
  `AuditSubjectKind` + `'platform'`; `AuditEntry.details.themeFrom/themeTo`; `AppearanceSettingsDoc`;
  `ThemePreviewPalette`.

TESTS — раздел 9.1.

OUT OF SCOPE
- `apps/app/**` (в т. ч. `server/`, `useAppearanceQuery`, SecureStore, SSR-middleware) — D2.
- `packages/design-tokens/**` (реестр `appThemes`, палитры, шрифты) — B/C; подключение превью к реестру и сторож
  равенства id — D2.
- Личная тема райдера, предпросмотр в приложении, смена темы админки, outbox-событие смены темы, отдельный rate-limit
  записи, `updatedBy` в ответе панели.
