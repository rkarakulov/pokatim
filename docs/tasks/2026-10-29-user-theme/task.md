# user-theme — личная тема райдера

## 1. Title

Выбор темы приложения райдером (вместо глобальной темы из панели).

## 2. Goal

Сейчас тему всем райдерам задаёт панель (`GET/PUT /v1/appearance`, ADR-0016, `docs/tasks/2026-10-27-app-themes/`,
решение T1 «глобальная, личная — возможный follow-up»). Делаем follow-up: каждый вошедший райдер сам выбирает одну из 7
тем в «Настройках»; выбор хранится на сервере (виден на всех его устройствах). Гость и вошедший без выбора — «Классика».

## 3. Scope

Решения пользователя (2026-10-29):

| # | Вопрос | Решение |
|---|---|---|
| U1 | Что с переключателем темы в панели | **убрать**: в «Оформлении приложения» панели остаётся только сезонный декор; тема по умолчанию — всегда «Классика» (`DEFAULT_APP_THEME_ID`) |
| U2 | Тема карточек для сторис / приглашения | **тема райдера**, который создаёт карточку (без выбора — «Классика») |
| U3 | Тема по умолчанию | «Классика» — гость и вошедший без выбора |
| U4 | Декор | остаётся глобальным, панель (`decor` в `GET/PUT /v1/appearance`) |

- **API:** личная тема в профиле райдера (поле `themeId?` документа профиля; нет — «Классика»). Чтение — поле
  `themeId` в `GET /v1/profile`; запись — отдельный `PUT /v1/profile/theme` `{ themeId }` (под `AuthGuard`, rate limit
  как у правок профиля). Панель: `PUT /v1/appearance` принимает только `decor` (+`version`), `themeId` из
  `UpdateAppearanceRequest`/`PanelAppearance` убирается; публичный `GET /v1/appearance` — только `decor` (старые сборки
  без `themeId` получают «Классику» — `toAppThemeId(undefined)`). Порт `APP_APPEARANCE.activeThemeId()` заменяется
  чтением темы райдера (story-cards, ride-invite: тема того, кто создаёт карточку; `themeId` уже входит в хеш входа
  карточки — смена темы даёт новую карточку).
- **Приложение:** строка «Тема» в хабе `settings/index` → экран `settings/theme`: 7 тем (`APP_THEME_IDS`) с превью
  (макеты схем как в панели — светлая+тёмная у тем «по системе», одна у «всегда тёмных»), названием и коротким
  описанием; выбранная — отметка (радиогруппа). Выбор применяется сразу (оптимистично), сохраняется на сервере; ошибка —
  баннер, тема возвращается к прежней.
- **Активная тема клиента:** вошедший — `themeId` из профиля (`['profile']`), гость / профиль неизвестен — последняя
  известная (native-кэш `pokatim.appTheme`, web — cookie), иначе «Классика». Выход — «Классика», кэш/cookie стираются.
- **SSR web без мигания:** клиент пишет в cookie своего origin `pokatim_theme=<id>` (не httpOnly, не секрет,
  `SameSite=Lax`, `Path=/`, срок ~1 год; стирается при выходе и при «Классике»). Web-сервер (`apps/app/server`) кладёт
  значение cookie запроса в per-request контекст (`AsyncLocalStorage` под `Symbol.for` в `globalThis`), рендер
  (`+html.tsx`, `initialThemeId`) читает его через `ssrThemeId()` и валидирует закрытым списком. Тема процесса и её
  периодический запрос к API (`+middleware.ts`, `refreshSsrTheme`) удаляются. Manifest — «Классика».
- **Панель:** экран «Оформление приложения» — только декор; превью тем уходят из панели.
- Документация: ADR-0021 (личная тема; поправка к ADR-0016 п. 4–5, T1), `pokatim-app.md`, `docs/product/` (настройки).

## 4. Out of Scope

- Тема для гостя локально (выбор без входа), «как в системе»/авто-смена по времени, новые темы.
- Смена темы панели (`panel`), сезонного декора и его доставки.
- Удаление поля `themeId` у документа `platform_settings` миграцией (остаётся неиспользуемым — без миграции, если
  architect не решит иначе).

## 5. Architecture Context

- api: `modules/profile` (документ, сервис, контроллер, порт темы для `sharing`), `modules/appearance` (только декор),
  `modules/sharing` (источник темы карточки).
- contracts: `appearance` (без `themeId` в панели/публичном ответе), `profile` (поле `themeId`, запрос смены темы).
- app: `features/appearance` (активная тема, cookie web, SSR-контекст), `features/settings`, `src/app/settings/theme.tsx`,
  `server/web-server.ts`, удаление `+middleware.ts`.
- admin: `features/appearance` — только декор.
- Совместимость: старые сборки читают `themeId` из `GET /v1/appearance` → поля нет → «Классика»; `GET /v1/profile` —
  новое поле аддитивно.

## 5.1 Placement & Reuse Gate

- Переиспользуем: `AppThemeId`/`APP_THEME_IDS`/`DEFAULT_APP_THEME_ID` (contracts), `appThemes` (design-tokens),
  `toAppThemeId`, `SettingsRow`, `useSettingsShell`, `withAccessToken`, `['profile']`-кэш, `readJson`/`secureStorage`.
- Превью тем (`previewOf`) — переносится из панели в общий пакет (`@pokatim/design-tokens`), не дублируется.
- Названия/описания тем — общие ключи i18n (не две копии под `admin.*` и `settings.*`).
- Тема профиля читается другими модулями только через порт `modules/profile/index.ts`.

## 6. Relevant Files

Полный список и роли — §11 (architect). Ключевые:

- api: `apps/api/src/modules/profile/{profile.collection,profile.repository,profile.service,profile.controller,profile.policy,profile.module,index}.ts`
  (+ новый порт `rider-themes.port.ts` / `rider-themes.ts`); `apps/api/src/modules/appearance/*` (только декор, порт
  `APP_APPEARANCE` удаляется); `apps/api/src/modules/sharing/{story-card.inputs,ride-invite.inputs,sharing.module}.ts`.
- contracts / api-client: `packages/contracts/src/appearance/appearance.schema.ts`,
  `packages/contracts/src/profile/profile.schema.ts`, `packages/api-client/src/{index,admin}.ts`.
- app: `apps/app/src/features/appearance/*`, `apps/app/src/app/{+html.tsx,+middleware.ts (удалить),_layout.tsx,
  manifest.webmanifest+api.ts,settings/index.tsx,settings/theme.tsx (новый)}`, `apps/app/src/features/profile/queries.ts`.
- admin: `apps/admin/src/features/appearance/*`, `apps/admin/src/features/audit/AuditScreen.tsx`.
- пакеты: `packages/design-tokens/src/` (превью тем), `packages/i18n/src/ru.ts`.

## 7. Implementation Notes

- Native: сплэш держится до чтения кэша как раньше; ответ профиля обновляет тему и кэш.
- Web: cookie пишется в эффекте (не в рендере); при отличии темы профиля от SSR — переключение после загрузки шрифтов
  (как сейчас при смене темы с сервера).
- Dev-сервер Expo (`expo start`) без `web-server.ts` — SSR в «Классике», клиент догоняет.

## 8. Risks / Assumptions / Open Questions

- Смена темы на другом устройстве: в этом браузере до ответа профиля — прежняя тема из cookie (одно переключение).
- Распространение `AsyncLocalStorage` через рендер expo-server — проверить тестом web-сервера / e2e.

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Решения U1–U4 не пересматриваются; ниже — уточнения реализации, принятые architect (A*), и находки (RC-*).

**Принятые решения**

- **A1. Хранение — поле `profiles.themeId?: AppThemeId | null`** (документ `_id` = userId). Нет поля / `null` —
  «Классика». Миграции **нет** (необязательное поле, чтение `?? null`, как `publicName`/`club`), индекса **нет** (по
  теме никто не ищет). Последняя миграция остаётся `0035`. Pipeline-upsert'ы профиля (`$set` с `KEEP_PROFILE_FIELDS`)
  чужие поля не трогают — `themeId` переживает правки имени, опрос, аватар; `replaceOne`/`$unset` в репозитории нет.
- **A2. Запись — отдельный `PUT /v1/profile/theme`** (`@Put('theme')` в `ProfileController`, статический сегмент;
  тело `UpdateProfileThemeRequest = strictObject({ themeId: AppThemeId })`, ответ — полный `ProfileView`, `no-store`).
  Почему не поле `PATCH /v1/profile`: PATCH — транзакция с журналом согласий и перевыпуском id фото (`writeProfile`),
  ПДн-путь; тема — не ПДн и не публичное, ей хватает **одной атомарной операции над одним документом вне транзакции**
  (`ProfileRepository.setTheme`: `updateOne`/`findOneAndUpdate` pipeline-upsert `{ ...KEEP_PROFILE_FIELDS, themeId:
  $literal, updatedAt: $literal }`, гонка двух первых upsert — `isDuplicateKey(_, '_id_')` и один повтор, как у
  `update`). PUT идемпотентен (повтор той же темы — та же запись), отдельный лимит (A3), `UpdateProfileRequest` и форма
  «Редактировать профиль» не меняются. Журнала смены темы у райдера нет (не чувствительное действие).
- **A3. Лимит — свой ключ `profile-theme:<uid>` 60/ч** (`PROFILE_POLICY.themeUpdateLimit`), до записи, `429 RATE_LIMITED`
  с `retryAfterSec`. Не общий `profile-update` 30/ч (см. RC-3).
- **A4. Стирание аккаунта** — ничего нового: `ProfileErasure.erase` удаляет документ `profiles` вместе с `themeId`;
  поздний `PUT /v1/profile/theme`, прошедший `AuthGuard` до отзыва сессий, может воскресить документ — убирает повторный
  проход (`account.erasure-resume`), как у PATCH/PUT avatar (`pokatim-db.md`). Новый порт стирания не нужен.
- **A5. Порт темы для `sharing`** — `RIDER_THEMES` (`RiderThemes.themeOf(userId): Promise<AppThemeId>`, нет документа /
  поля — `DEFAULT_APP_THEME_ID`) в `ProfileCoreModule`, экспорт через `modules/profile/index.ts`. `userId` —
  **запрашивающий карточку** (тот же `userId`, что в `resolve(userId, …)`: владелец заявки для сторис; любой видящий
  райд для приглашения). `SharingModule`/`SharingWorkerModule` уже импортируют `ProfileCoreModule` — новых рёбер графа
  нет, импорт `AppearanceCoreModule` из `sharing` убирается. Кэш: `themeId` уже в `storyCardHash`/`rideInviteHash` —
  смена темы даёт новый ключ; `renderVersion` **не поднимается** (разметка не меняется); старые PNG живут до TTL 24 ч.
  Worker перечитывает тему по `job.userId` — сменил тему между запросом и рендером → хэш не совпал → `skipped`, клиент
  перезапросит (существующий путь). Комментарий `rideInviteHash` «картинка у всех одна» → «одна на тему».
- **A6. `appearance` — только декор.** `AppAppearanceService`, `app-appearance.port.ts`, экспорт `APP_APPEARANCE` —
  удаляются; `AppearanceCoreModule` можно слить в `AppearanceModule` (потребителей вне модуля больше нет).
  `AppearanceSettingsDoc.themeId` → необязательное legacy-поле (не читается и не пишется; первая вставка документа —
  без `themeId`); миграции нет — поле остаётся в существующем документе (Out of Scope §4). Журнал
  `appearance.theme_changed`, `AUDIT_ACTIONS` и `themeFrom/themeTo` деталей — **остаются** (история); новых записей
  этого действия не будет.
- **A7. SSR web — без своего `AsyncLocalStorage`.** Проверено по коду `expo-server@58.0.5`: адаптер
  `expo-server/adapter/express` уже запускает **каждый запрос** в `AsyncLocalStorage` (`vendor/express.js`: `STORE =
  new AsyncLocalStorage()`, `createNodeRequestScope` кладёт `requestHeaders: request.headers`), а ссылка на scope лежит в
  `globalThis[Symbol.for('expoServerRuntime')]` (`runtime/scope.js`: «When multiple versions of @expo/server are
  bundled, we still want to reuse the same scope») — т. е. проблема «разные графы модулей серверных бандлов» уже решена
  самим Expo. Публичный API — `import { requestHeaders } from 'expo-server'` (`runtime/api.d.ts`: «immutable copy of the
  current request's headers»), доступен в рендере `+html.tsx`, корня и API-маршрутов. Решение: `ssrThemeId()` =
  `try { toAppThemeId(cookieValue(requestHeaders().get('cookie'), 'pokatim_theme')) } catch { DEFAULT_APP_THEME_ID }`
  (вне запроса — dev-сервер `expo start`, jest — `requestHeaders()` бросает «Runtime APIs can only be called during
  ongoing requests» → «Классика»). `server/web-server.ts` и `server/main.ts` **не меняются** (кроме LOW RC-10).
  Loader корня не подходит: `loader` — посев данных экрана (`useLoaderSeed`), его результат не виден `+html.tsx`, а у
  `_layout` loader-а в Expo Router нет; middleware не может передать значение рендеру (тот же глобальный стейт).
  Проверка, что контекст переживает рендер, — e2e (AC4, §11 TESTS).
- **A8. Удаление** `src/app/+middleware.ts`, `refreshSsrTheme`, `SSR_THEME_PATHS`, `isSsrThemePage`, состояния
  `Symbol.for('pokatim.appTheme')` и `ssr-theme-fetch.test.ts`; `fetchPublicForSsr` для темы больше не вызывается
  (упоминание middleware в комментарии `src/lib/public-ssr.ts` и в `pokatim-app.md` — убрать). Manifest —
  `appThemes[DEFAULT_APP_THEME_ID]` (ставится один раз при установке PWA, личная тема в нём бессмысленна).
- **A9. Активная тема клиента** (`useActiveThemeId`, единственный источник; провайдер и `_layout` не меняются по
  смыслу): `signedIn` → `themeId` профиля (`useQuery(['profile'], fetchProfile, { enabled: signedIn, select })` — тот же
  ключ и `queryFn`, что у Главной/профиля, лишнего запроса нет; перезапрос на фокус — смена с другого устройства); пока
  профиль не пришёл или ошибка — последняя известная (native: `pokatim.appTheme`; web: `initialThemeId()` = SSR из
  cookie); сессия `unknown` — последняя известная; сессия **`signedOut`** (любой путь: «Выйти», отзыв сервером, refresh
  401, запуск без сессии) — «Классика» + стереть кэш native / cookie web (RC-2). Сохранение: `saveCachedThemeId(id)`
  (native — SecureStore как сейчас; **web — запись cookie** в `appearance-cache.web.ts`, только в эффекте), «Классика» —
  `clearCachedThemeId()` (native — удалить ключ, web — `Max-Age=0`). Стирание делается в хуке по статусу сессии, **не в
  `useSignOut`** (он не покрывает отзыв сервером и refresh 401). `useAppearanceQuery` (тема из `/v1/appearance`)
  удаляется; `useDecorQuery` остаётся.
- **A10. Мутация** `useSetTheme` (`features/appearance/` или `features/profile/queries.ts`): `networkMode: 'always'`,
  `scope: { id: 'profile-theme' }` (TanStack Query 5.104 — мутации одного scope идут последовательно: откат ранней
  ошибки не затирает позднюю оптимистичную), `onMutate` — `cancelQueries({ queryKey: ['profile'], exact: true })`,
  снимок, `setQueryData(['profile'], { ...prev, themeId })`; `onError` — откат к снимку + баннер; `onSuccess` —
  `setQueryData(['profile'], view)`. Без префиксной инвалидации `['profile']` (анкета/статистика/история не нужны).
- **A11. Панель:** `PUT /v1/admin/appearance` с `themeId` — **400** (`strictObject`); `UpdateAppearanceRequest` =
  `strictObject({ decor: AppDecorId, version })` (декор обязателен, `refine` уходит); `PanelAppearance` без `themeId`
  (панель деплоится с API — строгая схема допустима). Открытая вкладка старой панели после деплоя получит ошибку разбора
  / 400 — перезагрузка (принято).
- **A12. Превью** — `previewOf` и типы переезжают в `@pokatim/design-tokens` (`app-theme-previews.ts`, экспорт из
  `index.ts`, тест там же): это производная реестра без React/RN, как `contrastPairsOf`. После U1 потребитель один
  (app) — но пакет уже существует, новый пакет не создаётся (инвариант 4 не нарушен). Компонент превью в приложении —
  `features/appearance/theme-preview.tsx` из `View` (фон, карточка, плашка заголовка, полоса «маршрута», плашка кнопки),
  **без SVG** (на native `react-native-svg` только лениво — не тянуть его в настройки), размеры — токены `space`/`size`/
  `stroke`, цвета — из `previewOf` (данные реестра, не литералы), `aria-hidden`/`importantForAccessibility="no"` —
  смысл несут подписи.
- **A13. i18n:** `admin.appearance.theme.<id>.{name,description}` → **`theme.<id>.{name,description}`**,
  `admin.appearance.scheme.{system,dark}` → `theme.scheme.*`, `admin.appearance.font` → `theme.font`; журнал панели
  (`AuditScreen`, `admin.audit.themeChange`) берёт названия из `theme.<id>.name`. Удаляются `admin.appearance.{legend,
  current,save,saved,saveFailed}`; `admin.appearance.hint` переписывается под декор; `admin.nav.appearance`/`title` —
  остаются. Новые: `settings.theme` («Тема»), `settings.theme.lead`, `settings.theme.saveFailed`.
- **A14. Декомпозиция — два PR** (см. §11 «PR-план»): **A** — contracts, api-client, API, admin, i18n; **B** — app.
  Между ними dev-приложение показывает «Классику» всем (сервер отдаёт `themeId: 'classic'`), сборка app компилируется
  (`AppAppearance` не меняется, app не использует `PanelAppearance` и ключи `admin.appearance.*`). Один PR допустим,
  но B сам по себе крупный (хук, экран, превью, SSR, e2e) — раздельное ревью дешевле.

**Находки**

- **RC-1 (HIGH, совместимость; решено A-вариантом).** §3 «публичный `GET /v1/appearance` — только `decor`; старые сборки
  получают «Классику» — `toAppThemeId(undefined)`» — неверно: в установленных сборках `AppAppearance.themeId` —
  **обязательное** `tolerantEnum` (union enum | string), `undefined` не проходит ни одну ветку → api-client бросает на
  разборе → запрос в ошибке → старая сборка остаётся в **последней кэшированной** теме (не «Классика») и **теряет
  декор** (`useDecorQuery` — тот же запрос). Варианты: (a) ответ остаётся `{ themeId: 'classic', decor }` — `themeId`
  константой `DEFAULT_APP_THEME_ID` (документ настройки не читается), схема `AppAppearance` не меняется, в JSDoc —
  «устарело, всегда classic, для сборок до user-theme»; (b) убрать поле — ломает старые сборки (выше); (c) сделать поле
  `.optional()` в контракте — не помогает уже установленным. **Принято (a)**; удаление поля — только новой версией
  эндпоинта, когда старых сборок не останется (`contracts.md`). Int-тест: документ с `themeId: 'chrono'` → публичный
  ответ всё равно `classic`.
- **RC-2 (MEDIUM, конфликт со U3).** §3 «гость / профиль неизвестен — последняя известная (кэш/cookie)» противоречит
  U3 «гость — Классика»: после истечения сессии (refresh 401 на запуске — переход `unknown → signedOut`, не
  `signedIn → signedOut`) кэш/cookie остался бы, и гость видел бы чужую/прежнюю тему. Варианты: (a) «последняя
  известная» только пока сессия `unknown`/профиль грузится; `signedOut` — «Классика» и стирание (A9); (b) стирать
  только в `useSignOut` — пропускает отзыв сервером и refresh 401; (c) хранить кэш до явного выхода — нарушает U3.
  **Принято (a).** Цена: web-гость с устаревшей cookie получает SSR в прежней теме и одно переключение на «Классику»
  после гидрации сессии (редко; cookie стирается этим же переходом).
- **RC-3 (MEDIUM).** «rate limit как у правок профиля» — если общий ключ `profile-update` 30/ч, то перебор тем
  (оптимистичный выбор = PUT на каждое нажатие) съедает бюджет правки имени/клуба, а 31-е нажатие откатывает тему с
  баннером. Варианты: (a) свой ключ `profile-theme:<uid>` 60/ч — **принято** (A3); (b) общий ключ + debounce на клиенте —
  сложнее, бюджет всё равно общий; (c) без лимита — нарушает правило «мутация — с лимитом».
- **RC-4 (LOW).** AC5 «400 либо игнор» — **400** (A11): строгие запросы панели (`pokatim-contracts.md`), тихий игнор
  скрыл бы ошибку старой вкладки панели.
- **RC-5 (LOW, тексты).** Описания тем писались для панели («Нынешний облик: …» у «Классики») — при переносе в общие
  `theme.*` переписать с точки зрения райдера («Облик по умолчанию: …»); названия не меняются (журнал панели).
- **RC-6 (LOW).** Строка «Тема» в хабе — значение = название **активной** темы (`useAppTheme().id` / `useActiveThemeId`),
  а не отдельный запрос профиля; экран `settings/theme` — выбор из `['profile']` (`useProfile`): первая загрузка —
  скелетон списка (`AsyncContent`, инвариант 12), ошибка без данных — «Нет соединения» / «Не удалось загрузить» с
  повтором; при показанных данных ошибка мутации — баннер `settings.theme.saveFailed` (429 — тот же баннер; сеть —
  `error.network`).
- **RC-7 (LOW, безопасность cookie).** К атрибутам cookie (§3) добавить `Secure`, когда `location.protocol === 'https:'`
  (dev по http — без него). Cookie не httpOnly — по замыслу (пишет клиент); XSS может лишь выставить id из закрытого
  списка.
- **RC-8 (LOW).** «Классика» в cookie не пишется (стирание) — SSR без cookie = «Классика»; при `themeId: 'classic'`
  в профиле native-кэш тоже стирается (`clearCachedThemeId`), сплэш-логика «кэш прочитан → `?? classic`» не меняется.
- **RC-9 (INFO).** Тема — предпочтение, не ПДн; в публичный профиль (`PublicRiderProfile`) и панель модерации не
  выходит; логов с темой нет.
- **RC-10 (LOW, опционально).** HTML теперь зависит от cookie — общих кэшей перед `web` нет (Caddy только проксирует,
  service worker кэширует лишь `dist/client`), но для честности добавить `Vary: Cookie` к ответам рендера в
  `web-server.ts` (не к статике) — одной строкой с тестом; не блокирует.

## 8.2 Deviations from spec

- **PR A, D1 (admin `CardRadioGroup`).** §11 велит убрать CSS `.card-radio*` панели, если других потребителей нет.
  Единственный потребитель CSS — компонент `src/ui/CardRadioGroup.tsx`, а его — только выбор тем «Оформления»; без CSS
  компонент нерабочий. Удалены компонент, его тест и экспорт из `src/ui/index.ts` вместе с CSS (мёртвый код не
  оставляем). Понадобится снова — восстановить из истории.
- **PR A, D2 (фикстуры `apps/app`).** `ProfileView.themeId` — обязательное поле выхода схемы: 15 тестовых фикстур
  профиля в `apps/app` (только тесты) получили `themeId: 'classic'`, иначе `apps/app` не компилируется. Логика
  приложения в PR A не менялась.
- **PR A, D3 (журнал).** Отдельной правки `AuditScreen.test.tsx` нет: существующий тест «Классика → Атлас» уже
  проверяет подписи, после перехода на `theme.<id>.name` он зелёный без изменений.

- **PR B, D4 (откат мутации темы).** A10 предполагает, что `scope` сам защищает от отката ранней ошибкой: в TanStack
  Query 5.104 `onMutate` всех мутаций очереди исполняется сразу при `mutate`, `scope` упорядочивает только запросы, —
  откат к снимку ранней смены перекрасил бы позднюю оптимистичную, а успех ранней — откатил бы её до ответа. Сделано:
  `useSetTheme` помнит тему, подтверждённую сервером; ответ или ошибка смены, пока в очереди есть более поздние,
  тему не трогают; ошибка последней — откат к подтверждённой (не к снимку прошлой оптимистичной). Тест — две быстрые
  смены в обоих порядках исходов.
- **PR B, D5 (тест `ssr-theme`).** §11 TESTS — проект jest `server`; там workspace-пакеты резолвятся из `dist`
  (сборки пакетов в тестах нет), поэтому `ssr-theme.test.ts` — в проекте `native` (Node), `expo-server` — мок
  `requestHeaders` + один случай с настоящим модулем вне запроса. Разбор cookie — `features/appearance/theme-cookie.ts`.
- **PR B, D6 (web-проект экрана).** Экран `settings/theme` — RNTL в проекте `native` (`settings-theme.test.tsx`, с
  корнем); в web-проекте — строка выбора с превью и описанием (`settings-row.web.test.tsx`: `radio`, `aria-checked`,
  описание), рендер экрана целиком — e2e. Cookie на https — отдельный файл `appearance-cache.https.web.test.ts` (jsdom
  не даёт подменить `location`, адрес — `@jest-environment-options`).
- **PR B, D7 (RC-10).** `Vary: Cookie` в `web-server.ts` не добавлен (опционально по RC-10; общих кэшей перед `web`
  нет).

## 8.3 Security checklist

Затронуто: новый эндпоинт записи (AuthGuard, только свой профиль, `themeId` — закрытый enum, rate limit), cookie темы
(не секрет, только id из закрытого списка при чтении, без ПДн), SSR вставляет id в `window.__POKATIM_THEME__` только
после валидации.

Чек-лист (architect):

- [ ] `PUT /v1/profile/theme` — `AuthGuard` на классе `ProfileController`, `userId` только из access (`@CurrentUser`),
  пути с id нет; без входа — 401 (int-тест).
- [ ] Тело — `ZodValidationPipe(UpdateProfileThemeRequest, FieldErrorCode)`, `strictObject`, `themeId` — строгий
  `AppThemeId` (незнакомый id, лишний ключ, не строка, `{ $ne: … }` — 400); в `$set` — только `$literal` примитива после
  zod (pipeline-upsert).
- [ ] Лимит `profile-theme:<uid>` 60/ч до записи, `429 RATE_LIMITED` + `retryAfterSec`; Redis — вне транзакции (её нет).
- [ ] `Cache-Control: no-store` на ответе; ответ — `ProfileView` своего пользователя (без `openReportCount` и служебных
  полей — `profileViewOf`).
- [ ] Логи: ни темы, ни cookie-заголовка запроса в логах web-сервера и API.
- [ ] Cookie `pokatim_theme`: значение при чтении на сервере — только через `toAppThemeId` (закрытый список; длинное,
  мусорное, несколько cookie с тем же именем — «Классика» или первое валидное); разбор заголовка без регулярок с
  возвратом и без `eval`; в HTML — только `JSON.stringify(theme.id)` из реестра, не сырое значение cookie.
- [ ] Атрибуты cookie: `Path=/; Max-Age=31536000; SameSite=Lax` (+ `Secure` на https, RC-7); не httpOnly — по замыслу;
  стирается при `signedOut` и при «Классике».
- [ ] `PUT /v1/admin/appearance` с `themeId` — 400; право `appearance.manage` и `PanelGuard` не меняются; журнал
  `appearance.decor_changed` пишется в транзакции как раньше; `appearance.theme_changed` — не пишется, история читается.
- [ ] Порт `RIDER_THEMES` отдаёт только id темы; `sharing` не получает доступа к документу профиля.
- [ ] Стирание аккаунта: `themeId` уходит вместе с документом `profiles` (`ProfileErasure`), int-тест не нужен сверх
  существующего (документ удаляется целиком).

## 9. Acceptance Criteria

1. Вошедший райдер видит в «Настройках» строку «Тема»; экран — 7 тем с превью и названием, текущая отмечена.
2. Выбор темы перекрашивает приложение сразу и сохраняется (`PUT /v1/profile/theme`); на другом устройстве после
   загрузки профиля — та же тема.
3. Гость и вошедший без выбора — «Классика»; после выхода — «Классика».
4. Web: перезагрузка страницы вошедшего с выбранной темой отдаёт SSR-HTML в его теме (`__POKATIM_THEME__`, фон
   документа) — без мигания; невалидная cookie — «Классика».
5. Панель: «Оформление приложения» — только декор; `PUT /v1/appearance` с `themeId` — 400 (строгая схема) либо
   игнор — по решению architect; журнал смены декора работает.
6. Карточки сторис и приглашения — в теме создателя.
7. Негатив: `PUT /v1/profile/theme` без входа — 401; незнакомый id — 400.
8. `pnpm check` зелёный; e2e web смоук с новым экраном.

## 10. Documentation Impact

ADR-0021 (+ ссылка-поправка в ADR-0016), `.claude/rules/pokatim-app.md` (настройки, темы, SSR), `docs/product/` —
раздел настроек, `docs/tasks/2026-10-27-app-themes/decisions.md` — T1 → ссылка на эту задачу.

architect: + `docs/adr/README.md` (индекс), правила `pokatim-backend.md`, `pokatim-db.md`, `pokatim-contracts.md`,
`pokatim-web.md`, `docs/product/admin-panel.md` (раздел и право — только декор); список по PR — §11.

## 11. Implementation Context

### PR-план (A14)

- **PR A — сервер и панель:** contracts + api-client + `apps/api` (profile theme, порт `RIDER_THEMES`, `sharing`,
  `appearance` только декор) + `apps/admin` (экран только с декором, журнал на `theme.*`) + i18n-переименование +
  ADR-0021 + правила backend/db/contracts/web. После мержа dev-приложение — «Классика» у всех (ожидаемо).
- **PR B — приложение:** активная тема из профиля, кэш/cookie, SSR через `requestHeaders()`, удаление
  `+middleware.ts`, экран `settings/theme`, строка в хабе, превью (`previewOf` уже в design-tokens из PR A либо
  переносится здесь — переносить в **A**, чтобы панель удаляла файлы в том же PR), e2e, правило `pokatim-app.md`,
  `docs/product/`.

### ENTRY POINTS

- API: `PUT /v1/profile/theme` → `ProfileController.setTheme` → `ProfileService.setTheme(userId, themeId)` →
  `ProfileRepository.setTheme`; `GET /v1/profile` → `profileViewOf` (+`themeId`).
- API: `GET /v1/appearance` → `AppearanceService.getPublic` (`{ themeId: DEFAULT_APP_THEME_ID, decor }`);
  `GET|PUT /v1/admin/appearance` → `AppearanceService.getPanel/update` (только декор).
- API: `StoryCardInputs.resolve` / `RideInviteInputs.resolve` → `RIDER_THEMES.themeOf(userId)`.
- App: `src/app/_layout.tsx` → `useActiveThemeId()` → `AppThemeProvider`; `src/app/+html.tsx` и
  `features/appearance/initial-theme-id.web.ts` → `ssrThemeId()` (`requestHeaders()` из `expo-server`);
  `src/app/settings/theme.tsx` (новый) → `useSetTheme`.
- Admin: `apps/admin/src/features/appearance/AppearanceScreen.tsx` (только блок декора).

### FILES TO MODIFY

PR A:
- `packages/contracts/src/appearance/appearance.schema.ts` — `AppAppearance` без изменений формы (JSDoc: `themeId`
  устарел, всегда `classic`); `PanelAppearance` без `themeId`; `UpdateAppearanceRequest` = `strictObject({ decor:
  AppDecorId, version: Version })` без `refine`. + `appearance.schema.test.ts`.
- `packages/contracts/src/profile/profile.schema.ts` — `ProfileView.themeId: tolerantEnum(APP_THEME_IDS)
  .default(DEFAULT_APP_THEME_ID)` (импорт из `../appearance/appearance.schema.ts`; старый сервер без поля — «Классика»,
  будущая тема в старой сборке — `'unknown'` → клиент `toAppThemeId` → «Классика»); новый `UpdateProfileThemeRequest`.
  + `profile.schema.test.ts`.
- `packages/api-client/src/index.ts` — `setProfileTheme(accessToken, body)` (`PUT /v1/profile/theme`, `ProfileView`);
  `getAppearance` без изменений. `packages/api-client/src/admin.ts` — `updateAppearance` с новым телом.
  + `profile.test.ts`, `admin.test.ts`, `index.test.ts` (публичный ответ с `classic`).
- `apps/api/src/modules/profile/profile.collection.ts` — `themeId?: AppThemeId | null` в `ProfileDoc` (JSDoc: нет поля —
  «Классика», без миграции).
- `apps/api/src/modules/profile/profile.repository.ts` — `VIEW_PROJECTION`/`ProfileViewDoc` + `themeId`; новый
  `setTheme(userId, themeId, now): Promise<ProfileViewDoc>` (pipeline-upsert с `KEEP_PROFILE_FIELDS`,
  `returnDocument: 'after'`, проекция view); `findTheme(userId)` для порта (проекция `{ themeId: 1 }`).
- `apps/api/src/modules/profile/profile.policy.ts` — `PROFILE_POLICY.themeUpdateLimit` (60/3600); `profileViewOf` +
  `themeId: doc?.themeId ?? DEFAULT_APP_THEME_ID`.
- `apps/api/src/modules/profile/profile.service.ts` — `setTheme`: лимит → запись → повтор при `_id_` дубле → `viewOf`.
- `apps/api/src/modules/profile/profile.controller.ts` — `@Put('theme')`, `@HttpCode(200)`, `no-store`.
- Новые `apps/api/src/modules/profile/rider-themes.port.ts` (`RIDER_THEMES`, `RiderThemes`) и `rider-themes.ts`
  (реализация на `ProfileRepository.findTheme`); `profile.module.ts` (provider + export в `ProfileCoreModule`);
  `index.ts` (экспорт порта).
- `apps/api/src/modules/sharing/story-card.inputs.ts`, `ride-invite.inputs.ts` — `@Inject(RIDER_THEMES)` вместо
  `APP_APPEARANCE`, `themeOf(userId)`; комментарий хэша приглашения. `sharing.module.ts` — без `AppearanceCoreModule`.
- `apps/api/src/modules/appearance/appearance.service.ts` — `getPublic` → `{ themeId: DEFAULT_APP_THEME_ID, decor }`;
  `update` — только декор (журнал `appearance.decor_changed`), вставка документа без `themeId`; `toPanelAppearance`
  без темы. `appearance.repository.ts` — тип `set` без `themeId`. `appearance.collection.ts` — `themeId?` legacy.
  `appearance.module.ts`, `index.ts` — без порта; удалить `app-appearance.port.ts`, `app-appearance.service.ts`.
  `appearance-admin.controller.ts`, `appearance-public.controller.ts` — JSDoc.
- `apps/admin/src/features/appearance/AppearanceScreen.tsx` — только «Сезонный декор»; удалить `ThemePreview.tsx`,
  `theme-previews.ts`, `theme-previews.test.ts` (тест переезжает в design-tokens); CSS `.theme-preview*` и
  `.card-radio` панели — убрать, если других потребителей нет (проверить grep).
- `apps/admin/src/features/audit/AuditScreen.tsx` — `t(\`theme.${id}.name\`)`.
- `packages/design-tokens/src/app-theme-previews.ts` (новый: `previewOf`, `ThemePreviewMock`, `ThemePreviewPalette`,
  `THEME_PREVIEWS` по `APP_THEME_IDS` реестра — design-tokens не зависит от contracts: брать порядок из `appThemes`) +
  экспорт из `index.ts` + тест.
- `packages/i18n/src/ru.ts` — переименование и новые ключи (A13), тексты описаний (RC-5).

PR B:
- `apps/app/src/features/appearance/use-active-theme-id.ts` — логика A9 (сессия + профиль + кэш), без
  `useAppearanceQuery`.
- `apps/app/src/features/appearance/appearance-query.ts` — оставить только декор (`useDecorQuery`; `select` декора;
  `toAppThemeId` больше не нужен здесь).
- `apps/app/src/features/appearance/appearance-cache.ts` — + `clearCachedThemeId` (SecureStore `delete`).
- `apps/app/src/features/appearance/appearance-cache.web.ts` — `saveCachedThemeId` пишет cookie, `clearCachedThemeId`
  стирает; `readCachedThemeId` → `null` (SSR уже в `window.__POKATIM_THEME__`). Имя cookie — константа здесь же и в
  `ssr-theme.ts` (общая константа модуля `features/appearance/theme-cookie.ts`, без `document`).
- `apps/app/src/features/appearance/ssr-theme.ts` — переписать: только `ssrThemeId()` через `requestHeaders()` +
  разбор cookie + `toAppThemeId`, fallback «Классика».
- `apps/app/src/features/appearance/initial-theme-id.web.ts` — без изменений по смыслу (JSDoc: «cookie запроса»).
- Удалить `apps/app/src/app/+middleware.ts`, `features/appearance/ssr-theme-fetch.test.ts`; переписать
  `ssr-theme.test.ts`.
- `apps/app/src/app/+html.tsx`, `manifest.webmanifest+api.ts` (→ `appThemes[DEFAULT_APP_THEME_ID]`), `_layout.tsx`
  (`<Stack.Screen name="settings/theme" />` в `Stack.Protected` рядом с `settings/language`; комментарий темы).
- `apps/app/src/app/settings/theme.tsx` (новый, образец `settings/language.tsx`: `useSettingsShell`, `DocumentTitle`,
  «Назад», заголовок, lead, `radiogroup` из 7 строк превью + название + описание, отметка выбранной).
- `apps/app/src/features/appearance/theme-preview.tsx` (новый продуктовый компонент, A12) + тест.
- Строка выбора с превью: расширить `SettingsRow` необязательным `leading`/`description` **или** отдельная
  `ThemeOption` в `features/appearance/` на тех же токенах (`radio`, `aria-checked`) — не копировать стили строки.
- `apps/app/src/app/settings/index.tsx` — строка «Тема, <название>» в секции `settings.app` перед «Язык».
- `apps/app/src/features/appearance/theme-mutation.ts` (или `features/profile/queries.ts`) — `useSetTheme` (A10).
- `apps/app/src/__tests__/app-routes.ts` — `'settings/theme': ThemeScreen`.
- `apps/app/src/lib/public-ssr.ts` — комментарий (middleware больше не потребитель).
- `apps/app/server/web-server.ts` — только если берётся RC-10 (`Vary: Cookie` на ответах рендера) + тест.
- `apps/app/e2e/web.spec.ts` — см. TESTS.

Документация (обоих PR, по зоне): `docs/adr/0021-user-theme.md` (новый) + `docs/adr/README.md`; в
`docs/adr/0016-app-themes.md` — строка-поправка «п. 4–5 и T1 заменены ADR-0021»; `.claude/rules/pokatim-backend.md`
(`appearance` — только декор, `GET /v1/appearance` — `themeId` константой; `profile` — `PUT /v1/profile/theme`, лимит,
порт `RIDER_THEMES`; `sharing` — порт темы `profile`; строка «у ProfileController только GET / и PATCH /» → + `PUT
theme`), `pokatim-db.md` (`profiles.themeId`; `platform_settings.appearance.themeId` — legacy), `pokatim-contracts.md`
(тема), `pokatim-web.md` («Оформление приложения» — только декор), `pokatim-app.md` (настройки: «Тема» есть; доставка
темы и SSR — cookie + `requestHeaders()`, без middleware), `docs/product/admin-panel.md` (право и раздел — декор),
`docs/product/profile.md` или раздел настроек (тема райдера), `docs/tasks/2026-10-27-app-themes/decisions.md` (T1 →
ссылка сюда).

### FILES TO READ

- `apps/api/src/modules/profile/profile.repository.ts` (`KEEP_PROFILE_FIELDS`, `updatePublicName`, `setAvatar` —
  образцы upsert), `profile.service.ts` (`update` — лимит и повтор при `_id_`), `rider-names.port.ts`/`rider-names.ts`
  (образец порта), `profile.int.test.ts`.
- `apps/api/src/modules/appearance/appearance.service.ts`, `appearance-admin.int.test.ts`,
  `appearance-public.int.test.ts`.
- `apps/api/src/modules/sharing/story-card.inputs.ts`, `story-card.inputs.test.ts`, `story-card.int.test.ts`
  (тест «смена темы … — новая картинка»), `ride-invite.int.test.ts`.
- `node_modules/expo-server/build/cjs/{runtime/api.js,runtime/scope.js,vendor/express.js,vendor/environment/node.js}`
  (корень монорепо) — A7.
- `apps/app/src/features/appearance/*`, `apps/app/src/theme/app-theme-provider.tsx`, `apps/app/src/app/_layout.tsx`
  (сплэш, подписка на выход), `apps/app/src/features/auth/session-store.ts`, `features/home/queries.ts`
  (`PROFILE_QUERY_KEY`, `fetchProfile`), `features/profile/queries.ts` (образцы мутаций), `app/settings/language.tsx`,
  `features/settings/settings-row.tsx`, `src/__tests__/settings-screen.test.tsx`, `e2e/web.spec.ts` (тест темы в HTML,
  блок «Настройки»).
- `apps/admin/src/features/appearance/*`, `apps/admin/src/features/audit/AuditScreen.tsx`.
- `docs/adr/0016-app-themes.md`, `docs/tasks/2026-10-27-app-themes/decisions.md`.

### TYPES & SCHEMAS

```ts
// contracts/profile/profile.schema.ts
ProfileView = z.object({ …, themeId: tolerantEnum(APP_THEME_IDS).default(DEFAULT_APP_THEME_ID) });
UpdateProfileThemeRequest = z.strictObject({ themeId: AppThemeId });
// contracts/appearance/appearance.schema.ts
AppAppearance  // форма та же; themeId — устарел, сервер всегда 'classic'
PanelAppearance = z.object({ decor: AppDecorId, version: Version, updatedAt: z.iso.datetime().nullable() });
UpdateAppearanceRequest = z.strictObject({ decor: AppDecorId, version: Version });
// api/modules/profile
interface ProfileDoc { …; themeId?: AppThemeId | null }
export const RIDER_THEMES = Symbol('RIDER_THEMES');
interface RiderThemes { themeOf(userId: string): Promise<AppThemeId> }
// app/features/appearance
const THEME_COOKIE = 'pokatim_theme';
function ssrThemeId(): AppThemeId;              // requestHeaders() → cookie → toAppThemeId, иначе classic
function saveCachedThemeId(id: AppThemeId): Promise<void>;   // native SecureStore | web cookie
function clearCachedThemeId(): Promise<void>;
// design-tokens
function previewOf(def: AppThemeDefinition): ThemePreviewPalette;
```

### TESTS

PR A:
- contracts: `UpdateProfileThemeRequest` (валидный id; незнакомый, лишний ключ, пусто — ошибка);
  `ProfileView.themeId` (нет поля → `classic`, незнакомый → `'unknown'`); `UpdateAppearanceRequest` (`{ decor, version }`
  ок; `themeId` — ошибка; без `decor` — ошибка); `PanelAppearance` без `themeId`.
- api-client: `setProfileTheme` — метод, путь, Bearer, тело; ответ не по схеме — ошибка; `updateAppearance` с декором.
- API int (реальная Mongo/Redis): `PUT /v1/profile/theme` — 401 без входа; 400 на `'neon'`/лишний ключ/`{ $ne }`;
  200 + `ProfileView.themeId`; `GET /v1/profile` — `classic` без документа и после выбора — выбранная; запись не
  трогает имя/согласие/клуб/аватар/`publicId` и не пишет журнал согласий; создаёт документ, если его нет (онбординг-флаги
  остаются «не пройдено»); параллельные два первых PUT — оба 200, один документ; лимит — 61-й запрос `429` с
  `retryAfterSec`, `PATCH /v1/profile` при этом не лимитирован; после `ProfileErasure.erase` — `classic`.
- API int appearance: публичный ответ — ровно `{ themeId: 'classic', decor }` даже при документе с `themeId: 'chrono'`;
  панель: `PUT` с `themeId` — 400; смена декора — журнал `appearance.decor_changed`; первая вставка документа без
  `themeId`; 409 по версии как раньше; `GET` журнала со старой записью `appearance.theme_changed` читается.
- API sharing: `story-card.int.test.ts` — смена темы через `PUT /v1/profile/theme` → новый ключ/токен; документ
  `platform_settings` с темой **не** влияет; `ride-invite.int.test.ts` — два райдера с разными темами → разные токены,
  с одной темой → один; unit `story-card.inputs.test.ts` — мок порта `RIDER_THEMES`.
- Сторож `profile.repository.test.ts` (единственный писатель) — по месту, если перечисляет методы.
- admin: `AppearanceScreen.test.tsx` — нет выбора тем, только декор; PUT тело `{ decor, version }`; 409 —
  `ConflictBanner`; `AuditScreen.test.tsx` — подпись смены темы из `theme.<id>.name`.
- design-tokens: `previewOf` (перенос `theme-previews.test.ts`: «по системе» — 2 макета, «всегда тёмная» — 1, радиус
  `shape.card`, гарнитура).
- `pnpm check`, `pnpm e2e:admin` (раздел открывается, декор переключается — если в смоуке есть, иначе не добавлять).

PR B:
- unit `use-active-theme-id.test.tsx`: native — сплэш (`null`) до чтения кэша; `signedIn` + профиль → тема профиля и
  `saveCachedThemeId`; профиль `classic` → `clearCachedThemeId`; профиль в ошибке → последняя известная; `signedOut`
  (запуск и переход из `signedIn`, включая отзыв сервером) → `classic` и стирание; `unknown` → кэш.
- unit `appearance-cache.web.test.ts` (jsdom): cookie пишется с `Path=/`, `SameSite=Lax`, `Max-Age`, `Secure` на https;
  стирание — `Max-Age=0`.
- unit `ssr-theme.test.ts` (проект jest `server`): мок `expo-server` `requestHeaders` — валидная cookie → id; мусор,
  незнакомый id, нет cookie, несколько cookie, очень длинный заголовок → `classic`; `requestHeaders` бросает → `classic`.
- `initial-theme-id.server.test.ts`/`.web.test.ts` — по месту.
- Мутация `useSetTheme`: оптимистично меняет `['profile']`, ошибка — откат и баннер, успех — ответ сервера; две быстрые
  мутации — итог последней (scope).
- Экран `settings/theme` (RNTL, native и web-проект): 7 радио с названием и описанием, выбранная `aria-checked`,
  нажатие → PUT и смена темы корня; первая загрузка — скелетон; ошибка профиля — экран ошибки с повтором; ошибка
  мутации — баннер, отметка возвращается; `useSettingsShell` для гостя.
- `settings-screen.test.tsx` — строка «Тема, Классика» ведёт на `/settings/theme` (заменить проверку «Темы нет»).
- `app-routes.ts` + сторожи маршрутов/`Stack.Protected` (гость на `/settings/theme` — как `/settings/language`).
- `theme-preview.test.tsx` — макеты по числу схем, без hex-литералов (сторож `theme-guards` не ломается).
- e2e `web.spec.ts` (без API): `request.get('/', { headers: { cookie: 'pokatim_theme=atlas' } })` → HTML с
  `window.__POKATIM_THEME__="atlas"`, `theme-color`/фон атласа и шрифты атласа в `#expo-generated-fonts`;
  `pokatim_theme=neon` и без cookie → `classic` (существующий тест); две параллельные загрузки с разными cookie —
  каждая в своей теме (доказательство per-request контекста); manifest — `theme_color` «Классики» при cookie атласа.
- e2e с API (`E2E_API=1`, блок «Настройки»): строка «Тема, Классика» → экран → выбор «Атлас» → `aria-checked`,
  `document.cookie` содержит `pokatim_theme=atlas`, перезагрузка — HTML уже `"atlas"`; «Выйти» → cookie нет, SSR
  `classic`.
- `pnpm check`, `pnpm build:web && pnpm e2e:web` (и `E2E_API=1` по runbook).

### OUT OF SCOPE

- Выбор темы гостем, «как в системе»/по времени, новые темы (§4).
- Удаление `themeId` из документа `platform_settings` миграцией и удаление `themeId` из `AppAppearance` (только новой
  версией эндпоинта после ухода старых сборок).
- Удаление действия журнала `appearance.theme_changed` и его i18n — история остаётся.
- Изменения разметки карточек и `renderVersion`; native-сплэш и системные пикеры (по-прежнему «Классика»/система).
- Изменение `web-server.ts`/`main.ts` сверх опционального `Vary: Cookie` (RC-10); свой `AsyncLocalStorage` — не
  делать (A7).
- Тема в публичном профиле, панели модерации, push/письмах.

## 12. Outcome

### PR A — сервер и панель (2026-10-29)

- **contracts:** `ProfileView.themeId` (`tolerantEnum`, `.default('classic')`), `UpdateProfileThemeRequest`;
  `PanelAppearance` без темы, `UpdateAppearanceRequest = strictObject({ decor, version })`; `AppAppearance` — форма та
  же, JSDoc «`themeId` устарел, всегда `classic`».
- **api-client:** `setProfileTheme` (`PUT /v1/profile/theme`); `updateAppearance` — тело только с декором.
- **api `profile`:** `profiles.themeId?` (без миграции и индекса), `ProfileRepository.setTheme`/`findTheme`,
  `ProfileService.setTheme` (лимит `profile-theme:<uid>` 60/ч → upsert → повтор при `_id_`), `PUT /v1/profile/theme`
  (`AuthGuard`, `strictObject`, `no-store`), `profileViewOf` + `themeId`; порт `RIDER_THEMES` (`rider-themes.port.ts`,
  `rider-themes.ts`) в `ProfileCoreModule`, экспорт из `index.ts`.
- **api `appearance`:** только декор; публичный `GET` — `{ themeId: 'classic', decor }`; `AppAppearanceService`,
  порт `APP_APPEARANCE`, `AppearanceCoreModule` удалены; `themeId` документа — legacy.
- **api `sharing`:** `StoryCardInputs`/`RideInviteInputs` — `RIDER_THEMES.themeOf(userId)`; импорт `appearance` убран.
- **design-tokens:** `previewOf`, `THEME_PREVIEWS`, типы превью (`app-theme-previews.ts` + тест, перенос из панели).
- **admin:** «Оформление приложения» — только декор; `ThemePreview`, `theme-previews*`, `CardRadioGroup` и CSS
  `.card-radio*`/`.theme-preview*` удалены (8.2 D1); журнал — `theme.<id>.name`.
- **i18n:** `admin.appearance.theme.*`/`scheme.*`/`font` → `theme.*`; удалены `admin.appearance.{legend,current,save,
  saved,saveFailed}`; новый `admin.appearance.hint`; `settings.theme`, `settings.theme.lead`,
  `settings.theme.saveFailed`; описание «Классики» — с точки зрения райдера (RC-5).
- **app:** только фикстуры тестов профиля (`themeId: 'classic'`, 8.2 D2) — логика не менялась.
- **Документация:** ADR-0021 (новый), поправка в ADR-0016, индекс ADR, правила `pokatim-backend.md`, `pokatim-db.md`,
  `pokatim-contracts.md`, `pokatim-web.md`, `docs/product/admin-panel.md`, `app-themes/decisions.md` (T1).
- **Тесты:** contracts (схемы профиля/оформления), api-client (`setProfileTheme`, декор панели, публичный ответ), API
  int `profile.int.test.ts` (401, 400 ×4, 200/GET, создание документа без онбординга, поля и журнал согласий не
  трогаются, изоляция, параллельные PUT, гонка `_id_`, лимит 61-го + PATCH не лимитирован, после стирания — `classic`,
  порт `RIDER_THEMES`), `appearance-{admin,public}.int.test.ts` (переписаны под декор, legacy `themeId` документа не
  выходит наружу, `themeId` в PUT — 400, история `theme_changed` читается), `story-card.int.test.ts` (тема через
  профиль — новый токен, тема платформы не влияет), `ride-invite.int.test.ts` (разные темы — разные картинки, одна —
  одна), unit `story-card.inputs.test.ts` (мок порта), `app-theme-previews.test.ts`, `AppearanceScreen.test.tsx`.
- **Проверки:** `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis) — зелёный: `Tasks: 15 successful, 15
  total`; api 163 файла / 1775 тестов, app 213 наборов / 1986 тестов, admin 38 / 366. Первый прогон app упал
  таймаутами при load average ~25 (параллельные агенты); отдельный прогон app и повторный `pnpm check` — зелёные.
  `pnpm e2e:admin` — раздела «Оформление» в смоуке нет, не добавлялся.
- **Не сделано (PR B):** приложение — экран `settings/theme`, активная тема из профиля, cookie/SSR, удаление
  `+middleware.ts`, e2e, `pokatim-app.md`, `docs/product/` (настройки).

### PR B — приложение (2026-10-29)

- **Активная тема** (`features/appearance/use-active-theme-id.ts`): вошёл — `themeId` профиля (`['profile']`, тот же
  `queryFn`, `enabled: signedIn`, `select` → `toAppThemeId`); сессия неизвестна / профиль не пришёл или в ошибке —
  последняя известная (native кэш, web SSR); `signedOut` — «Классика» и стирание кэша / cookie в хуке (RC-2). Запись
  кэша — в эффекте: тема → `saveCachedThemeId`, «Классика» → `clearCachedThemeId` (RC-8). `useAppearanceQuery`
  удалён, `appearance-query.ts` — только `useDecorQuery`.
- **Кэш:** native `clearCachedThemeId` (SecureStore `delete`); web `appearance-cache.web.ts` — cookie `pokatim_theme`
  (`Path=/; Max-Age=31536000; SameSite=Lax` + `Secure` на https, RC-7), стирание `Max-Age=0`, чтение — `null`.
- **SSR:** `ssr-theme.ts` — `ssrThemeId()` = `requestHeaders()` expo-server → `themeIdFromCookieHeader`
  (`theme-cookie.ts`: `split` без регулярок, первая валидная) → иначе / вне запроса «Классика». `+middleware.ts`,
  `refreshSsrTheme`, тема процесса и `ssr-theme-fetch.test.ts` удалены; manifest — `appThemes[DEFAULT_APP_THEME_ID]`;
  `web-server.ts`/`main.ts` не менялись.
- **UI:** экран `src/app/settings/theme.tsx` (`useSettingsShell`, `DocumentTitle`, «Назад», lead, `AsyncContent` со
  скелетоном 7 строк, радиогруппа `SettingsRow` + `leading` превью + `description`, баннер ошибки — сеть
  `auth.error.network`, прочее и 429 `settings.theme.saveFailed`); `features/appearance/theme-preview.tsx` (из `View`,
  цвета `THEME_PREVIEWS`, скрыт от скринридера); `SettingsRow` — необязательные `leading`, `description`
  (`accessibilityHint`); строка «Тема, <активная>» в хабе перед «Языком»; маршрут в `Stack.Protected` и `app-routes.ts`.
- **Мутация** `features/appearance/theme-mutation.ts` — `useSetTheme` (A10 + 8.2 D4).
- **Тесты:** `use-active-theme-id.test.tsx` (11), `appearance-cache.test.ts` (+стирание), `appearance-cache.web.test.ts`,
  `appearance-cache.https.web.test.ts`, `ssr-theme.test.ts` (16), `theme-mutation.test.tsx` (5),
  `theme-preview.test.tsx` (8), `settings-theme.test.tsx` (9: список, выбор → PUT и тема корня, ошибки ×3 с откатом,
  скелетон, ошибки профиля ×2 с повтором, гость), `settings-screen.test.tsx` («Тема, Классика» → `/settings/theme`,
  гость), `settings-row.web.test.tsx`; `route-detail.test.tsx` — тема из профиля вместо `/v1/appearance`. e2e
  `web.spec.ts`: тема из cookie в HTML (`atlas`: `theme-color`/фон `#F2F3F5`, шрифты Manrope без Inter; мусор и
  незнакомые → `classic`), 12 параллельных загрузок с разными cookie, manifest «Классика» при cookie; шаг «Тема» в
  смоуке с API (выбор «Атласа», cookie, SSR после перезагрузки, выход → cookie нет, SSR `classic`).
- **Документация:** `.claude/rules/pokatim-app.md` (настройки — «Тема»; доставка темы — профиль, cookie,
  `requestHeaders()`, без middleware; SSR-данные без middleware), `docs/product/profile.md` (раздел «Тема приложения»),
  `docs/product/README.md`.
- **Проверки:**
  - `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm build:web` — зелёный (импорт `expo-server` в web-бандле
    собирается; без `EXPO_PUBLIC_API_URL` сборка падает по своей проверке переменной — не связано).
  - SSR вручную (`node server/main.ts`, порт 18731): `Cookie: pokatim_theme=atlas` → `__POKATIM_THEME__="atlas"`,
    `theme-color` и фон `#F2F3F5`, `#111316` в тёмной схеме, шрифты Manrope; `neon`, `%3Cscript%3E`, без cookie →
    `classic`; `sid=1; pokatim_theme=chrono` → `chrono`; manifest при `chrono` — `#FFFFFF`; 18 параллельных запросов с
    тремя темами — каждая в своей (per-request контекст expo-server работает).
  - `pnpm e2e:web` (без API, `E2E_PORT=18740`): новые 3 теста — зелёные; 23 passed, 8 skipped (с API), 5 failed —
    гарды `/rides/report`, `/rides/invite`, `/rides/route-pick`, `/routes/pick`, `/routes/rides` без сессии не
    показывают «Нет соединения» за 5 с; на базе (`apps/app/src` из `HEAD~1`, отдельная сборка) падают те же 5 —
    не регрессия PR B.
  - `E2E_API=1` — NOT VERIFIED (локально нет поднятого API/Mailpit для смоука).
  - `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis) — зелёный с первого прогона: `Tasks: 15 successful,
    15 total`; app — 217 наборов / 2012 тестов.
