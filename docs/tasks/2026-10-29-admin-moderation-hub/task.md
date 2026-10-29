# task: admin-moderation-hub — один раздел «Модерация» с вкладками

Уровень: task2 (только `apps/admin` + строки `packages/i18n`, без API и контрактов). Ветка
`feature/admin-moderation-hub` от `origin/develop`, PR в `develop`.

## 1. Goal

Три очереди модерации («Модерация райдов», «Маршруты райдеров», «Профили райдеров») занимали три пункта внизу сайдбара.
Решение пользователя (2026-10-29): один пункт «Модерация» с вкладками по типу контента — как в прототипе панели
(«очередь модерации — отдельные вкладки по типу контента»).

## 2. Scope

- `navigation.ts`: вместо трёх пунктов — «Модерация» (`admin.nav.moderation`) в группе `bottom` на месте «Модерации
  райдов»; виден при любом из `routes.moderate` / `profiles.moderate` / `rides.moderate` (`NavItem.anyPermission`),
  подсвечен на путях очередей и их карточек (`NavItem.sections`).
- `/moderation` — редирект на первую доступную вкладку (порядок: «Маршруты райдеров», «Профили райдеров»,
  «Кофе-райды»); без прав — «Нет доступа к разделу».
- `features/moderation/ModerationTabs` под `PageHeader` трёх списков: ссылки на прежние адреса (`/rider-routes`,
  `/rider-profiles`, `/rides-moderation`), только с правом, текущая — `aria-current="page"`; число ждущих решения из
  `overviewQuery` (маршруты — `pending + reported`); загрузка, ошибка, ноль — без числа.

## 3. Out of Scope

- API, контракты, адреса очередей и карточек, содержимое экранов очередей и карточек `$id`.
- Свой эндпоинт счётчиков (берём «Обзор»).

## 4. Acceptance

- AC1. Пункт «Модерация» один, виден при любом одном из трёх прав, скрыт без них; порядок `bottom`: «Сотрудники»,
  «Журнал действий», «Модерация», «Оформление приложения».
- AC2. Пункт подсвечен (`aria-current="page"`) на `/rider-routes`, `/rider-profiles`, `/rides-moderation` (с любыми
  параметрами) и на карточках `…/$id`; на других разделах — нет.
- AC3. `/moderation` открывает первую доступную вкладку (с заменой записи истории); без прав — «Нет доступа к разделу»
  без запросов очередей.
- AC4. Вкладки (`nav` «Очереди модерации») — только разрешённые, по порядку; текущая — `aria-current="page"` (и при
  `?tab=` / `?state=`).
- AC5. Число на вкладке — из «Обзора»; скринридер слышит «ждут решения: N»; ноль, загрузка, ошибка «Обзора» — без
  числа, экран очереди работает.

## 8.2 Решения

- Имя поля «любое из прав» — `anyPermission` (рядом с `permission`, взаимоисключающие по смыслу); подсветка раздела —
  `sections` + `useMatchRoute({ fuzzy: true })`, потому что сам `/moderation` только перенаправляет.
- Ключи `admin.nav.ridesModeration`, `admin.nav.riderRoutes`, `admin.nav.riderProfiles` удалены (не используются);
  подписи вкладок — `admin.moderation.tab.*` («Кофе-райды» — как раздел приложения). Заголовки экранов не менялись
  («Модерация райдов» остаётся заголовком очереди кофе-райдов).
- Вкладки — продуктовый компонент в `features/moderation` (ссылки роутера), не `ui/` (там нет зависимостей от роутера);
  стиль — `.tabs*` в `index.css` на токенах.

## 12. Outcome

Сделано:

- `apps/admin/src/navigation.ts` — `anyPermission`, `sections`, `isNavItemVisible`; один пункт «Модерация».
- `apps/admin/src/layout/AppLayout.tsx` — видимость через `isNavItemVisible`, подсветка раздела по `sections`.
- `apps/admin/src/features/moderation/{moderation-tabs.ts,ModerationTabs.tsx,ModerationTabs.test.tsx}` — вкладки,
  порядок и счётчики, тесты AC1–AC5.
- `apps/admin/src/router.tsx` — маршрут `/moderation` (`beforeLoad` → `redirect`, иначе `NoAccessScreen`).
- Списки `RidesModerationScreen`, `RiderRoutesScreen`, `RiderProfilesScreen` — `<ModerationTabs />` под шапкой.
- `apps/admin/src/index.css` — `.tabs`, `.tabs__link`, `.tabs__count`.
- `packages/i18n/src/ru.ts` — `admin.nav.moderation`, `admin.moderation.*`; три старых ключа навигации удалены.
- Тесты: `AppLayout.test.tsx` (пункты меню по ролям, `/moderation` у организатора), моки `overview` в тестах трёх
  очередей.
- Документы: `docs/product/admin-panel.md`, `.claude/rules/pokatim-web.md`.

Проверки:

- `pnpm --filter @pokatim/admin test` — 41 файл, 404 теста, зелёные; новые тесты до реализации — красные.
- `pnpm --filter @pokatim/admin typecheck`, `pnpm lint`, `pnpm arch:check`, `pnpm format:check` — чисто.
- `TURBO_CONCURRENCY=1 pnpm check` — всё зелёное, кроме `@pokatim/api#test` (API не менялся): с
  `MONGO_URL_TEST=…/pokatim_modhub` — Startup Error глобального setup (имя тестовой базы должно оканчиваться на
  `_test`). Отдельно с `…/pokatim_modhub_test`: unit 588/588; integration 94/96 — два таймаута 20 с под нагрузкой
  (`account-erasure`, `results-check`), повтор этих файлов — 46/46.
