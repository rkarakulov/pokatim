# plan-C.md — PR C `feature/event-tickets-panel`: материалы, панель билетов, check-in

Architect, 2026-10-29. Основа — task.md §3.0 T4, §5.2, §5.3, §5.5 (PR C), §8.1 RC-T3/T6/T9/T10, §9 AC6/AC9 и код PR A
(`apps/api/src/modules/tickets`, `packages/contracts/src/tickets`, `packages/api-client/src/admin.ts`). Ветка — от свежего
`origin/develop` **после мержа PR A**. Status: **CONCERNS** (блокеров нет; решения RC-C1…RC-C9 coder принимает по
умолчанию, если человек не решит иначе).

## 0. Факты из кода (проверено)

- `origin/develop` — последняя миграция `0036_overview_indexes`; PR A добавляет `0037_tickets` → PR C — **`0038_event_materials`**
  (сверить с `origin/develop` перед мержем: параллельные сессии).
- Доступ панели к событию — приватный `TicketingAdminService.event(principal, kind, eventId, purpose)` (eventAccess → 403
  до чтения, чужое/нет — 404; гонка — только `published|cancelled` через `RACE_REGISTRY.get`). Материалы используют **ту же**
  проверку → вынести в общий класс (см. §2), копии нет.
- Загрузки: `src/raw-body.ts` `readLimited` (octet-stream, 413/415/408, `Connection: close`) — общий; образцы —
  `routes-admin.controller.ts` (панель, лимит до тела, без слотов) и `profile-avatars.controller.ts`. Отдача байтов —
  `avatars-public.controller.ts` (заголовки через `HttpAdapterHost` после чтения, 404 — JSON без `immutable`).
- https-URL: `RegistrationUrl` (`contracts/src/calendar/calendar.schema.ts`: https, ≤ длины, без `user:pass@`) — переиспользовать.
- Непредсказуемый id: `randomToken` (`identity/index.ts`), формат `OpaqueToken` (43 символа base64url).
- Панель: нет страницы старта календаря (форма — rail `CalendarForm` на списке `CalendarScreen`); `AppShell` без адаптивности
  (нет `@media`); чекбокса в `src/ui` нет; `FileButton`, `DataTable`, `Dialog`, `ConflictBanner`, `DateTimeField`,
  `TextAreaField`, `SelectField`, `StatusTag`, `EmptyState/ErrorState` — есть.
- CSP панели — `infra/docker/admin-nginx.conf` (`$panel_csp`, повторён в каждом `location`), тот же заголовок отдаёт
  `vite preview` (`apps/admin/vite.config.ts` читает конфиг), сторож — `apps/admin/src/csp.test.ts`. **`Permissions-Policy` нигде
  не задан** (ни nginx, ни Caddy, ни web-сервер приложения) — камера доступна по умолчанию (`camera` default allowlist =
  `self`), но политики явно нет.
- Приложение: внешние ссылки — только `src/lib/open-external-url(.web).ts`; карточки — `app/races/[id].tsx`,
  `features/calendar/calendar-detail.tsx`. Экрана билета `/tickets/[code]` в develop нет (PR B).
- Письмо: `TicketEmailHandler` + `renderTicketEmail` (`APP_WEB_ORIGIN` — тот же хост, Caddy проксирует `/v1/*` на api).

## 1. Requirements Consistency (PR C)

- **RC-C1 Страница старта календаря отсутствует; «форму не раздувать».** R: одна страница управления
  `EventTicketsScreen` по маршрутам `races/$raceId/tickets` и `calendar/$startId/tickets` (секции «Билеты», «Материалы»,
  «Участники»); на странице гонки (`RaceEditor`, только `published|cancelled`) и в rail календаря — **компактный блок
  «Билеты»** (статус «включены/выключены», N участников, ссылка «Билеты и материалы»). Альтернативы: (б) всё inline в
  `RaceEditor` (699 строк, своя кнопка «Сохранить» — две формы на экране) и в узком rail календаря; (в) отдельный раздел
  сайдбара «Мероприятия» (новый раздел без нужды).
- **RC-C2 Check-in с телефона vs «панель — desktop 1440».** Организатор сканирует на старте телефоном; `AppShell` не
  адаптивен. R: маршрут `/check-in` — дочерний отдельного защищённого layout-маршрута **без сайдбара** (`checkInLayoutRoute`
  под `rootRoute` с тем же `beforeLoad`, что `appRoute`; ссылка «← В панель»), раскладка экрана — flex/проценты, работает от
  360 px; пункт сайдбара ведёт туда же. Альтернативы: (б) только ноутбук с веб-камерой; (в) адаптивный `AppShell` (шире
  scope, admin-kit).
- **RC-C3 PDF inline + `CSP: sandbox`.** Chromium не показывает PDF во встроенном просмотрщике документа с `sandbox` (пустая
  страница/блокировка), а убирать `sandbox` с байтов организатора на origin приложения — нельзя (тот же хост, что `/admin`).
  R: `Content-Disposition: attachment; filename="material.pdf"; filename*=UTF-8''<имя>` — файл скачивается (мобильные
  открывают системный просмотрщик) + `default-src 'none'; sandbox` + `nosniff`. Альтернативы: (б) `inline` без `sandbox`
  (активное содержимое PDF на нашем origin — отвергнуто); (в) отдельный cookieless-домен файлов (новая инфраструктура).
- **RC-C4 Отклонение от «Файлы — подписанные URL» (`security.md`).** T4 уже решил «как аватары ADR-0019». R: дописать в
  ADR-0023 раздел «Материалы» с этим исключением (публичный контент организатора, id = `randomToken`, удаление = 404,
  `immutable`-кэш — принятый риск как у аватаров). Без ADR-поправки reviewer обязан ставить замечание.
- **RC-C5 Модель «тип» vs «формат».** Список типов смешивает тему (`rules`, `parking`…) и формат (`pdf`, `link`, `text`). R:
  `type` — тема-подпись (иконка/заголовок группы), содержимое — **одно** из: `url` (https) | `file` (PDF) | только текст
  (`description` обязателен). Правила: `link`, `gpx` → только `url`; `text` → без `url`/файла, `description` обязателен;
  `pdf` → только файл; остальные темы — `url` | файл | текст. Проверка — `superRefine` контракта + повтор в сервисе.
- **RC-C6 Загрузка PDF — один шаг.** `POST …/materials/files` с метаданными в query **создаёт материал вместе с файлом** в
  одной транзакции → сирот нет, регламент чистки не нужен. Замена PDF = загрузить новый + удалить старый (PATCH файл не
  меняет). Альтернатива — двухшаговая загрузка + sweep сирот (лишняя задача).
- **RC-C7 Метод удаления.** §5.5 пишет `DELETE`; конвенция API (RC-A5, `POST …/delete`) и `api-client` — POST с глаголом. R:
  `POST …/materials/:id/delete`; порядок — `PUT …/materials/order`. Записать в 8.2.
- **RC-C8 Аудит материалов.** Правило журнала — все мутации панели. R: в конец `AUDIT_ACTIONS` —
  `tickets.material_added`, `tickets.material_updated` (`details.changedFields`), `tickets.material_removed`,
  `tickets.materials_reordered`; subject — событие (`race`/`calendar_start`, label — название). Плюс долг PR A: показ
  `details.ticketCode` в «Журнале действий».
- **RC-C9 Видимость публичного списка.** R: `GET /v1/events/:kind/:eventId/materials` — только для публично видимого события
  (гонка `published|cancelled` — как `RACE_REGISTRY.get`; старт календаря `published`), **независимо от `enabled`** билетов
  (правила и парковка полезны до регистрации); иначе один 404. Файл `GET /v1/event-files/:id` событие не проверяет (как аватар;
  снятие старта не отзывает уже розданные ссылки — принятый риск, удаление материала — 404).

## 2. Placement & Reuse

- Всё API — в модуле `tickets` (§5.1: материалы — часть контекста). Новых модулей/пакетов нет; рёбра графа не меняются.
- **Вынести** `PanelEvents` (`panel-events.ts`, `TicketsModule`): `resolve(principal, kind, eventId, purpose)` → `PanelEvent`
  (тело приватного `TicketingAdminService.event`); `TicketingAdminService` и `MaterialsAdminService` зовут его (механический
  перенос, тесты PR A должны остаться зелёными).
- Reuse: `readLimited` + `DEFAULT_BODY_TIMEOUTS`, `PublicReadGuard` + `IpRateLimitGuard`/`@IpRateLimit`,
  `PUBLIC_READ_CACHE_CONTROL`, `randomToken`, `consumeUserLimit` (`src/user-limit.ts`), `PanelAudit`, `MongoTransactions`,
  `RegistrationUrl`, `SINGLE_LINE`/`MULTI_LINE`/`optionalText`, `escapeHtml`/`htmlEmail`. Панель — `src/ui/*`, `field-errors.ts`,
  `format.ts`, `ConflictBanner`, `FileButton`. Приложение — `openExternalUrl`, `AsyncContent`/`Skeleton*`, компоненты
  `@rkarakulov/ui`.
- Запрещённые дубли: вторая проверка доступа к событию; свой валидатор https; своё чтение тела; свои форматтеры кода билета
  (есть `normalizeTicketCode`/`formatTicketCode` в контрактах); своя карта прав в UI.
- Новые зависимости: **`jsqr`** (apps/admin, MIT, без eval; только динамический `import()` — отдельный чанк). Первым —
  нативный `BarcodeDetector` (`qr_code` в `getSupportedFormats()`), иначе `jsqr`. Других нет.

## 3. Контракты (`packages/contracts`, append-only)

`src/tickets/materials.schema.ts` (новый, экспорт из `index.ts`):

- `EVENT_MATERIAL_TYPES = ['rules','what_to_bring','clothing','route','safety','gpx','parking','start_procedure','nutrition',
  'weather','pdf','link','text']` (в ответах — `tolerantEnum`, в запросах — `z.enum`).
- Константы: `EVENT_MATERIAL_TITLE_MAX = 120`, `EVENT_MATERIAL_DESCRIPTION_MAX = 1000`, `EVENT_MATERIALS_MAX = 20`,
  `EVENT_MATERIAL_FILES_MAX = 10`, `EVENT_MATERIAL_FILE_MAX_BYTES = 10 * 1024 * 1024`, `EVENT_MATERIAL_FILE_NAME_MAX = 120`.
- `EventMaterialFileId = OpaqueToken` (43 base64url).
- `EventMaterial` (публичный и в `TicketView`): `{ id: Uuid, type, title, description: string|null, url: string|null,
  file: { id, name, size } | null }` — порядок массива = порядок показа; без `version`, `updatedBy`, дат.
- `EventMaterialAdmin = EventMaterial + { version, updatedAt }`; `EventMaterialsAdmin = { items, filesLeft, itemsLeft }`.
- `EventMaterialInput = strictObject({ type, title (SINGLE_LINE, 1–120, trim), description: optionalText(1000, MULTI_LINE),
  url: RegistrationUrl.nullable() })` + `superRefine` RC-C5 (`pdf` — запрещён здесь: только загрузка).
- `UpdateEventMaterialRequest = strictObject({ type?, title?, description?, url?, version })` (файл не меняется; итог —
  повторно через правила RC-C5 на сервере).
- `EventMaterialUploadQuery = strictObject({ type (≠ link|gpx|text), title, description?, fileName })`, `fileName` —
  SINGLE_LINE ≤ 120 (сервер нормализует: без `/\\"`, расширение `.pdf`).
- `ReorderEventMaterialsRequest = strictObject({ ids: z.array(Uuid).min(1).max(20) })` (без повторов).
- `TicketView` — `materials: z.array(EventMaterial).optional()` (старые клиенты лишнее поле отбрасывают; сервер шлёт всегда).
- `common.ts`, конец `ErrorCode`: `MATERIAL_FILE_UNSUPPORTED` (415), `MATERIAL_FILE_TOO_LARGE` (413);
  `TICKETING_INVALID_STATE.details.reason` + `'materials_limit'` | `'files_limit'` (в конец).
- `admin/audit.schema.ts` — 4 действия RC-C8 в конец. Тесты порядка enum/кодов/действий.
- api-client: приложение — `getEventMaterials(kind, eventId)`, `eventFileUrl(fileId)` (строка без запроса); панель —
  `listEventMaterials`, `createEventMaterial`, `uploadEventMaterial(kind, eventId, body: Blob, query)` (octet-stream,
  `credentials: 'same-origin'`, как `uploadRoute`), `updateEventMaterial`, `deleteEventMaterial`, `reorderEventMaterials`,
  `eventFileUrl`. Тесты URL/методов.
- Совместимость: только новые поля/ручки; старые приложения без `materials` работают.

## 4. API (`apps/api/src/modules/tickets`)

| Ручка | Гард / право | Поведение |
|---|---|---|
| `GET /v1/admin/events/:kind/:eventId/materials` | `PanelGuard`, `PanelEvents.resolve(…,'manage')` (403/404 как настройки) | список по `order`, `itemsLeft`, `filesLeft`; `no-store` |
| `POST …/materials` | то же | тело `EventMaterialInput`; лимит 20 → 409 `TICKETING_INVALID_STATE{materials_limit}`; транзакция: count → insert (`order = max+1`) → журнал `material_added`; 201 |
| `POST …/materials/files?type&title&description&fileName` | то же | **до тела**: доступ → лимит `tickets-material-upload:<uid>` 30/ч → счётчики (20 материалов, 10 файлов) → `readLimited(10 МиБ, {MATERIAL_FILE_UNSUPPORTED, MATERIAL_FILE_TOO_LARGE})` (`Connection: close` при отказе) → сигнатура `%PDF-` с offset 0 (иначе 415) → транзакция: повтор счётчиков → insert файла (`_id = randomToken()`) → insert материала → журнал; 201 |
| `PATCH …/materials/:id` | то же | `version` → 409 `CONFLICT`; правила RC-C5 по итоговому документу; без изменений — без записи/журнала; журнал `material_updated` + `changedFields` |
| `POST …/materials/:id/delete` | то же | транзакция: delete материала (условие `kind,eventId`) → delete файла → журнал; нет — 404 |
| `PUT …/materials/order` | то же | `ids` ≠ текущему множеству → 409 `CONFLICT`; `bulkWrite` `order = index` в транзакции; журнал `materials_reordered` |
| `GET /v1/events/:kind/:eventId/materials` | `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL` | RC-C9; `EventMaterial[]` |
| `GET /v1/event-files/:fileId` | `PublicReadGuard` + `IpRateLimitGuard` `@IpRateLimit('event-file', 60/ч)` | pipe `EventMaterialFileId` (кривой → 404); после чтения: `Content-Type: application/pdf`, `Content-Length`, `Content-Disposition` (RC-C3), `Cache-Control: public, max-age=31536000, immutable` (только 200), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Referrer-Policy: no-referrer`; 404 — JSON без `immutable` |

- `:id` материала — `Uuid` pipe; каждый фильтр — `{ _id, kind, eventId }` (материал чужого события — 404).
- Порядок контроллеров/путей: `materials/files` и `materials/order` — статические сегменты, объявить **до** `materials/:id`.
- `admin-routes.test.ts`: материалы — как `ticketing` (PanelGuard без `@RequirePermission`, право по `kind` в сервисе) —
  проверить, что сторож пропускает класс так же, как `TicketingAdminController`; иначе — тот же механизм исключения.
- `TicketView.materials` — `TicketsReadService.view` читает `MaterialsRepository.listOf(kind, eventId)` (проекция без байтов).
- Письмо — `TicketEmailHandler` передаёт `materials` в `renderTicketEmail`: блок «Материалы» — `title` ссылкой; `url` —
  как есть, файл — `${APP_WEB_ORIGIN}/v1/event-files/<id>` (нет origin — файлы не выводятся), текстовые — заголовок и
  описание; всё через `escapeHtml`, в text-версии — «Название: URL». Идемпотентность письма не меняется.
- Логи: `tickets.material_uploaded event=<kind:id> size=<n>`, отказы — код; без названий файлов и URL.

Новые файлы: `materials.collection.ts` (или расширение `TICKETS_COLLECTIONS`: `materials: 'event_materials'`,
`materialFiles: 'event_material_files'`), `materials.repository.ts` (единственный писатель обеих коллекций; `listOf`
проекцией без `bytes`), `materials.policy.ts` (+ test: `MATERIALS_POLICY`, `isPdf`, `materialContentRule`,
`safeFileName`, `contentDisposition`), `materials-admin.service.ts`, `materials-admin.controller.ts`,
`materials-public.controller.ts` (`events/:kind/:eventId/materials`), `event-files.controller.ts`, `panel-events.ts`,
`materials-view.ts` (doc → `EventMaterial`). Правки: `tickets.module.ts`, `ticketing-admin.service.ts` (→ `PanelEvents`),
`tickets-read.service.ts`, `jobs/ticket-email.handler.ts`, `mail/ticket-email.ts`, `error-messages.ts` (2 кода),
`db/migrations/0038_event_materials.ts` + `index.ts` + `migrations.int.test.ts`.

## 5. Данные — `0038_event_materials` (expand-only, идемпотентна, без бэкфилла)

- `event_materials`: `_id` uuidv7, `kind`, `eventId`, `type`, `title`, `description|null`, `url|null`,
  `file: { id, name, size } | null` (денормализация — список без чтения байтов), `order` (int), `version`, `createdAt`,
  `updatedAt`, `updatedBy`. Индекс `event_materials_event_idx {kind:1, eventId:1, order:1}`.
- `event_material_files`: `_id` = `randomToken()`, `kind`, `eventId`, `materialId`, `bytes` (Binary ≤ 10 МиБ),
  `contentType: 'application/pdf'`, `fileName`, `size`, `createdAt`, `createdBy`. Только чтение по `_id` — вторичных
  индексов нет (счёт файлов — по `event_materials.file != null` через индекс события).
- Документ ≤ 10 МиБ + метаданные < 16 МБ BSON; вставка в транзакции допустима. ПДн нет (`updatedBy`/`createdBy` — сотрудники,
  как в `races`) → шаг стирания аккаунта не нужен; записать в `pokatim-db.md`.

## 6. Панель (`apps/admin`)

Маршруты (`router.tsx`): `races/$raceId/tickets`, `calendar/$startId/tickets` (`RequirePermission` не на маршруте — право
по виду: гонка `races.manage`|`races.manage_any`, календарь `calendar.manage`; 403/404 сервера → «Нет доступа» / «не найдено»);
`check-in` — RC-C2 layout без сайдбара, `RequirePermission permission="tickets.checkin"`. Навигация: `{ to: '/check-in',
labelKey: 'admin.nav.checkIn', permission: 'tickets.checkin', group: 'main' }` после «Календаря».

`features/tickets/`:

| Компонент | Содержание | Состояния |
|---|---|---|
| `TicketingSummary` | компактный блок на `RaceEditor` (`published|cancelled`, `Can races.manage`) и в rail календаря: «Билеты включены · N участников» / «Билеты выключены», ссылка «Билеты и материалы» | скелетон строки; ошибка — строка «Не удалось загрузить» + повтор; 403 — блок скрыт |
| `EventTicketsScreen` | `PageHeader` (крошка «Гонки»/«Календарь» → название), три секции | шапка видна сразу; скелетон секций |
| `TicketingSettingsForm` | RHF + zod `EventTicketingUpdate`: `CheckboxField` «Выдавать билеты» (новый в `src/ui/fields.tsx` + тест), гонка — `DateTimeField` старт (подсказка окна гонки, RC-T3) и «Окончание» (необязательно), место, адрес; календарь — `ReadonlyField` дата/время/место из старта, `capacity` (пусто = без лимита, «Зарегистрировано: N»); инструкции `TextAreaField` ≤ 2000 со счётчиком | выключение при `activeTickets > 0` — `Dialog` «У N участников билеты станут недействительными» (RC-T6); 400 — ошибки под полями (`field-errors.ts`); 409 `CONFLICT` — `ConflictBanner`; 409 `TICKETING_INVALID_STATE` — `Banner` по `reason`; кнопка disabled на время запроса; ошибка обновления при данных — баннер с повтором |
| `MaterialsSection` | список по порядку: тип (`StatusTag`-метка), название, источник («Ссылка» / «PDF · 1,2 МБ» / «Текст»), кнопки «Выше»/«Ниже» (клавиатура, без drag-n-drop), «Изменить», «Удалить»; «Добавить материал», `FileButton` «Загрузить PDF» (`accept="application/pdf,.pdf"`), счётчик «Осталось N» | пусто — `EmptyState` «Материалов пока нет»; скелетон строк; удаление — `Dialog` подтверждения (без причины: не необратимое для участия, журнал пишет действие); перестановка — оптимистично не делаем: кнопки disabled до ответа, 409 → перечитать + `ConflictBanner`; лимит — кнопки `aria-disabled` + `DisabledReason` |
| `MaterialDialog` | RHF + zod `EventMaterialInput`/`UpdateEventMaterialRequest`: `SelectField` тип, название, описание, URL (поле по правилам RC-C5 — показ/скрытие по типу) | ошибки под полями; 409 — баннер в окне |
| `MaterialUploadDialog` | после выбора файла: тип (без `link/gpx/text`), название (по умолчанию — имя файла без расширения), описание; клиентская предпроверка размера ≤ 10 МиБ (только подсказка) | 413/415 — под полем файла («Только PDF до 10 МБ»); прогресс — состояние кнопки |
| `ParticipantsSection` (`Can tickets.checkin`) | `DataTable`: код (`formatTicketCode`), участник, группа/дистанция, статус (`StatusTag`), отмечен (время Минск), письмо (`emailState`, `failed` — предупреждение); «Показать ещё» по курсору | скелетон; пусто — «Пока никто не зарегистрирован»; ошибка — `ErrorState` с повтором |

`features/check-in/`:

- `CheckInScreen` — две колонки ≥ 900 px, одна < 900 px: `QrScanner` + `ManualCodeForm` + `CheckInResultCard`.
- `QrScanner` — камера только по кнопке «Включить камеру» (жест пользователя): `getUserMedia({ video: { facingMode:
  'environment' }, audio: false })` → `<video muted playsInline>`; распознавание ~5 кадров/с (`requestVideoFrameCallback`,
  иначе `setTimeout`), кадр уменьшается до ≤ 640 px на `canvas` (`willReadFrequently`); стоп треков при уходе/скрытии вкладки.
  Состояния: `idle`, `starting`, `scanning`, `denied` («Доступ к камере запрещён — разрешите в настройках браузера или
  введите код»), `unavailable` (нет камеры / не secure context / нет API), `error`. Без камеры экран полностью работает
  ручным вводом.
- `scanner.ts` (чистые функции + unit): выбор декодера, `parseScan` (строго `TicketQrPayload`, иначе «Это не билет
  «Покатим»» без запроса), дедупликация (тот же payload ≤ 5 с — без запроса; во время запроса/показа карточки — пауза).
- `ManualCodeForm` — `TicketCode` контракта (`XXXXX-XXXXX`, регистр/`-`/`O→0` нормализует сервер и схема).
- Поток: скан/код → `lookupTicket` → карточка (событие, дата, участник, группа, статус) → «Отметить» (только `outcome:
  ready`) → `checkInTicket` → `checked_in` (время). `already_checked_in` — «Уже отмечен {время} · {сотрудник}»;
  `cancelled` / `event_cancelled` / `outside_window` — отказ текстом (`Banner` danger/warning). 404 — «Билет не найден или
  событие недоступно» (нейтрально); 403 — «Нет доступа»; 429 — «Слишком часто — подождите минуту». «Следующий» — сброс
  карточки и возобновление скана. Результат объявляется `role="status"`/`aria-live`.
- Камера и CSP: `<video>.srcObject` (MediaStream) и `getImageData` — CSP не меняется; `jsqr` — свой чанк (`script-src 'self'`).
  **Новый заголовок** `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()` — в серверный
  блок и **каждый** `location` `admin-nginx.conf` (add_header заменяет набор), в `preview.headers` `vite.config.ts` (вынести
  чтение в общий хелпер, как `panelCsp()`), сторож — `csp.test.ts` (заголовок во всех location, `camera=(self)`).
- Журнал: подписи 4 новых действий (`@pokatim/i18n` `admin.audit.action.tickets.*`), показ `details.ticketCode`
  («Билет ·XXXXX-XXXXX») в `AuditScreen`.
- `src/test/app.tsx` — фикстура organizer + `tickets.checkin` (долг PR A).

## 7. Приложение (`apps/app`) — минимально

- `src/components/event-materials.tsx` (+ test): список строк (иконка по `type` из набора `Icon`, название, описание
  ≤ 2 строк, «PDF · 1,2 МБ»); нажатие — `openExternalUrl(url ?? api.eventFileUrl(file.id))`; текстовый материал без
  ссылки — раскрытие описания. Только токены и `@rkarakulov/ui`.
- `src/features/tickets/materials-query.ts` — `eventMaterialsQuery(kind, id)` (публичная ручка, `staleTime` 60 с).
- Карточки: `app/races/[id].tsx` (гонка) и `features/calendar/calendar-detail.tsx` — блок «Материалы» после описания: первая
  загрузка — `Skeleton*` строк; пусто/404 — блока нет; ошибка — строка «Не удалось загрузить» с повтором.
- Билет (`/tickets/[code]`, PR B) — тот же компонент по `ticket.materials` (без запроса). Если PR B ещё не смержен — эта
  правка переезжает в PR B/следующий PR (см. риски).
- Все платформы: компонент без `Platform.OS`; web — ссылки через `open-external-url.web.ts`.

## 8. Security checklist (обязателен: файлы, публичные URL, права, `infra/**`)

1. AuthN/AuthZ: каждая ручка материалов — `PanelGuard` + `PanelEvents.resolve` (нет права — 403 до чтения; чужая гонка без
   `manage_any` / календарь без `calendar.manage` — 404); фильтры материалов всегда с `kind,eventId`. Check-in UI — только
   отображение, источник истины — сервер PR A.
2. Входные данные: контракт `strictObject`; https-URL без учётных данных (`RegistrationUrl`); тексты без управляющих символов;
   PDF — octet-stream ≤ 10 МиБ (`readLimited`, обрыв на лимите), тип — по сигнатуре `%PDF-`, не по имени/заголовку; имя файла
   нормализуется; лимиты 20 материалов / 10 файлов на событие (повтор в транзакции).
3. Данные наружу: публичный список — без `version`, `updatedBy`, дат и id сотрудников; файл — `application/pdf`,
   `attachment`, `nosniff`, `CSP: default-src 'none'; sandbox`, `Referrer-Policy: no-referrer`; id файла — `randomToken`.
   В письме — без QR/токена (не меняется).
4. Злоупотребления: загрузка — `tickets-material-upload:<uid>` 30/ч до тела; отдача — `public-read` + `event-file` 60/ч на IP;
   повторный скан — дедупликация клиента + серверный `tickets-checkin` 120/мин.
5. Логи: id и размеры, без названий, URL, имён файлов, кодов билетов в URL.
6. Аудит: 4 действия материалов в транзакции мутации (RC-C8).
7. Инфраструктура: `Permissions-Policy` панели (nginx + preview + сторож), смоук `pnpm e2e:admin` с тем же заголовком.

## 9. Тест-матрица

| Уровень | Тест | Что доказывает |
|---|---|---|
| int API | `tickets-materials.int.test.ts` | права на **каждую** ручку: модератор 403, organizer чужой гонки 404, organizer + календарь 403, admin ок; CRUD и порядок; `version` → 409; ids ≠ множеству → 409; RC-C5 (http/`user@` URL, `text` без описания, `link` без URL, `pdf` через JSON → 400); лимиты 20/10 → 409 `materials_limit`/`files_limit`; журнал по каждой мутации (subject, `changedFields`); материал чужого события по id → 404 |
| int API | там же, загрузка | не-PDF (`PNG`/`<html>%PDF-`) → 415; `text/plain` → 415; 10 МиБ + 1 → 413 + `Connection: close`; PDF → 201, затем `GET /v1/event-files/:id`: все заголовки (тип, длина, `attachment` + `filename*` с кириллицей и кавычкой, CSP sandbox, nosniff, immutable); неизвестный/кривой id → 404 JSON без `immutable`; удаление материала → файл 404; лимит загрузок → 429 до чтения тела |
| int API | `tickets-materials-public.int.test.ts` (или в том же) | публичный список: порядок, явный набор ключей, `public` кэш; неопубликованный старт / черновик гонки → 404; `enabled:false` — список отдаётся (RC-C9) |
| int API | `tickets-read.int.test.ts`, `tickets-email.int.test.ts` (дополнить) | `TicketView.materials`; письмо со ссылками (URL, файл через `APP_WEB_ORIGIN`), без env — без файлов; повтор задачи — одно письмо |
| int API | `tickets-admin.int.test.ts` | без регрессий после выноса `PanelEvents` |
| int API | `migrations.int.test.ts` | `0038` — индекс, идемпотентность |
| unit API | `materials.policy.test.ts`, `mail/ticket-email.test.ts` | `isPdf`, `safeFileName`, `contentDisposition` (CRLF, кавычки, не-ASCII), правила RC-C5, экранирование материалов в письме |
| contracts / api-client | `materials.schema.test.ts`, порядок `ErrorCode`/`AUDIT_ACTIONS`/типов; методы клиента | контракт и URL |
| RTL панели | `TicketingSettingsForm.test.tsx` | гонка: включение без старта → ошибка сервера под полем; выключение с N → `Dialog`; 409 → `ConflictBanner`; календарь — `capacity`, readonly старт; скелетон/ошибка с повтором |
| RTL панели | `MaterialsSection.test.tsx` | пусто; добавить ссылку; загрузка не-PDF → текст 415; «Выше/Ниже» шлёт полный `ids`; удаление через подтверждение; лимит — `DisabledReason` |
| RTL панели | `ParticipantsSection.test.tsx` | строки, статусы, «Показать ещё», пусто, `failed` письма |
| RTL панели | `CheckInScreen.test.tsx` + `scanner.test.ts` | ручной код → карточка `ready` → «Отметить» → `checked_in`; `already_checked_in` (время, сотрудник); `cancelled`/`outside_window`; 404/429 тексты; `denied` камеры — ручной ввод работает; мок `BarcodeDetector` → lookup один раз (дедупликация); не-`PKT1` — без запроса; стоп треков при размонтировании |
| RTL панели | `navigation`/`RaceEditor`/`AuditScreen` | пункт «Check-in» только с `tickets.checkin`; `TicketingSummary` на опубликованной гонке; подпись `ticketCode` и 4 действий |
| сторож | `csp.test.ts` | `Permissions-Policy` с `camera=(self)` во всех location + preview |
| e2e admin | `pnpm e2e:admin` (смоук) | `/admin/check-in` открывается под CSP и `Permissions-Policy`, ручной ввод неизвестного кода → «Билет не найден…» (камера в CI не запрашивается) |
| app | `event-materials.test.tsx`, `calendar-detail.test.tsx` (+ гонка) | строки, открытие URL/файла через `openExternalUrl`, пусто — блока нет, ошибка — повтор |

Отрицательные доказательства (как в PR A): убрать проверку сигнатуры → тест 415 красный; убрать `kind,eventId` из фильтра
PATCH → тест «материал чужого события» красный.

## 10. Риски

- 10 МиБ из Mongo на каждый GET без серверного кэша (память/полоса API): ограничено IP-лимитом и `immutable`; при росте —
  объектное хранилище/подписанные URL (ADR-0011) — follow-up.
- Chromium и PDF под `sandbox` — поэтому `attachment` (RC-C3); проверить вручную на iOS Safari / Android Chrome (открытие из
  приложения через внешний браузер).
- `BarcodeDetector` есть не везде (Firefox, desktop Safari) → `jsqr` на main thread; на слабых телефонах — 5 кадров/с и
  ≤ 640 px; при лагах — перенос в Web Worker (`worker-src 'self'` уже разрешён).
- Камера требует secure context: dev/prod — https; `localhost` — ок; `vite preview` по IP с телефона — нет (только ввод кода).
- PR B не смержен → материалы на экране билета откладываются; порядок B → C для приложения или вынос этой правки.
- Номер миграции `0038` — сверить перед мержем.
- Вынос `PanelEvents` трогает код PR A — только после его мержа (иначе конфликт ревью).

## 11. Порядок работ

1. Контракты (`materials.schema.ts`, `TicketView.materials`, коды, причины, действия журнала) + тесты → api-client (+ тесты).
2. `PanelEvents` (вынос, тесты PR A зелёные).
3. Коллекции, миграция `0038`, `MaterialsRepository`; `materials.policy.ts` (TDD).
4. `MaterialsAdminService`/контроллер (CRUD, порядок, загрузка), публичный список, `event-files` → int-тесты.
5. `TicketView.materials`, письмо (unit + int).
6. Панель: `CheckboxField`, `TicketingSummary`, `EventTicketsScreen` (настройки → материалы → участники), маршруты.
7. Check-in: `scanner.ts` (unit) → `QrScanner` → экран и layout без сайдбара, навигация; `jsqr`; `Permissions-Policy` +
   `csp.test.ts`; журнал (`ticketCode`, подписи); фикстура organizer.
8. Приложение: `event-materials` + карточки (+ билет, если PR B в develop).
9. Документы (§12) → `pnpm check`, `pnpm --filter @pokatim/admin build`, `pnpm e2e:admin`.

## 12. Documentation Impact

ADR-0023 — раздел «Материалы» (RC-C3/C4: Mongo Binary, `randomToken`, `attachment` + sandbox, без подписанных URL) и
«Check-in в браузере» (`BarcodeDetector`/`jsqr`, `Permissions-Policy`); `docs/product/tickets.md` — материалы, экран
check-in;
`docs/product/admin-panel.md` — страница «Билеты и материалы», «Check-in», 4 действия журнала; `.claude/rules/pokatim-web.md`
— `features/tickets`, `features/check-in`, layout без сайдбара (исключение из desktop 1440), `Permissions-Policy` в
`admin-nginx.conf`; `pokatim-backend.md` — `PanelEvents`, материалы, лимиты `tickets-material-upload`/`event-file`;
`pokatim-db.md` — `event_materials`, `event_material_files`, `0038`; `pokatim-security.md` — отдача PDF (рядом с аватарами);
`pokatim-contracts.md` — `tickets/materials.schema.ts`; `pokatim-app.md` — `event-materials`; task.md 8.2 — RC-C1/C6/C7
(делает оркестратор/coder, не architect).

## 13. Out of scope (PR C)

Напоминания и их настройка (PR D), Wallet (PR E), сканер в приложении райдера, замена PDF без удаления, просмотр PDF внутри
приложения, drag-n-drop порядка, объектное хранилище файлов, отзыв розданных ссылок на файл при снятии события.
