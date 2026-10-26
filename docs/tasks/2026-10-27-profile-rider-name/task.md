# 1. Title

Профиль райдера: публичное имя в таблице результатов гонки — поле «Как вас показывать в результатах» и согласие
на показ в `profile`, `GET`/`PATCH /v1/profile`, порт имён для `results`, имя в публичной таблице
`GET /v1/races/:raceId/results` и в приложении.

# 2. Goal

Сейчас строки публичной таблицы гонки анонимны: модели имени нет (race-results-03, A12: «Участник», своя — «Вы»;
имена — слайсом профиля). Райдер должен сам задать подпись и явно разрешить показ. Тогда в таблице вместо «Участник»
будет его имя: в предварительной таблице и в таблице опубликованного протокола.

Источники: `docs/tasks/2026-10-27-race-results-03-attempts/task.md` §8.1 A12, `.claude/rules/pokatim-db.md`
(профиль — ПДн отдельно от учётки, анонимизация при удалении), решение D2 кофе-райдов (`RideOrganizerName`) как
образец поля.

**Human gate пройден** (автор, 2026-10-26). Решения P1–P5 — в §8.

# 3. Scope

**Contracts (`packages/contracts/src/profile`):**
- `RiderPublicName`: необязательная подпись одной строкой, 2–80 символов после trim, пусто → `null`. Тот же
  конструктор, что у `RideOrganizerName` (`optionalText` + `TOO_SHORT`). Коды полей: `TOO_SHORT`, `TOO_LONG`,
  `INVALID`.
- `ProfileView` — **только добавление полей**: `publicName: string | null`, `showNameInResults: boolean`. При разборе
  ответа старого сервера без этих полей — `null` / `false` (`.default`).
- `UpdateProfileRequest` (`PATCH /v1/profile`) — `z.strictObject({ publicName?: RiderPublicName,
  showNameInResults?: boolean })`, нужен хотя бы один ключ (иначе 400 `VALIDATION_FAILED`). Лишние ключи — 400.
- `RaceResultRow` — **только добавление**: `riderName: string | null` (`.nullable().default(null)` — новый клиент
  со старым сервером). Комментарий «без ПДн» заменить: имя есть только при явном согласии райдера (P1).

**API, модуль `profile`:**
- `GET /v1/profile` отдаёт новые поля (документа или полей нет → `null` / `false`).
- `PATCH /v1/profile` (`AuthGuard`, `no-store`, пользователь — из access): частичное обновление `publicName` и/или
  `showNameInResults`. Одна атомарная операция над документом (upsert по `_id`, pipeline с `$literal`), как
  `upsertSurvey`. Документа нет — создаётся без ответа опроса (`rideReasons: []`, `surveyCompletedAt: null`, как у
  `markDevicesStep`). `updatedAt` — `CLOCK`. Ответ — `ProfileView` после записи. Лимит частоты — как у других записей
  своего профиля (если общего лимита нет — по образцу `PUT …/survey`).
- Порт для других модулей — `RIDER_NAMES` (`RiderNameDirectory`): `publicNames(userIds: string[]):
  Promise<Map<string, string>>`. В карте только пользователи с `publicName !== null && showNameInResults === true`.
  Один запрос `find({ _id: { $in } })` с проекцией, без новых индексов. Пустой вход → пустая карта без запроса.
  Экспорт из `profile/index.ts`, провайдер — в `ProfileModule` (exports).
- Миграции нет: поля необязательные, чтение старых документов — `?? null` / `?? false`. Валидатора коллекции нет
  (`0004_profile`).

**API, модуль `results`** (минимальный отдельный блок; параллельно идёт слайс 06 «Споры»):
- `ResultsReadService.publicResults` — и живая ветка, и `protocolResults`: после выборки страницы один вызов
  `RIDER_NAMES.publicNames(userIds страницы)`. В строку добавляется `riderName: names.get(userId) ?? null`. Имя
  читается при каждом запросе, в снимок протокола `race_protocol_rows` **не пишется** (P3). Порт можно звать вне
  snapshot-сессии: имя не участвует в согласованности мест.
- `ResultsModule` импортирует `ProfileModule` (или провайдер порта), циклов модулей нет (`profile` → `identity`).

**api-client:** `updateProfile(accessToken, body)` → `PATCH /v1/profile`, ответ `ProfileView`; тест на URL, метод,
Bearer и тело.

**Приложение (`apps/app`):**
- Экран `settings/profile.tsx` «Профиль» под тем же гардом, что `settings/devices` (`useSettingsShell`, регистрация
  в корневом `_layout`). Поле «Как вас показывать в результатах» (подсказка-пример «Анна К.»), переключатель
  «Показывать имя в таблицах результатов» с пояснением «Имя увидят все в таблицах результатов гонок. Выключите — вы
  будете «Участник»». Кнопка «Сохранить». Ошибки полей — по кодам контракта (`TOO_SHORT`, `TOO_LONG`, `INVALID`).
  Клиентская проверка — та же схема. Состояния: загрузка, ошибка с повтором, сохранение, успех (сообщение).
  Пустое имя при включённом переключателе допустимо: в таблице будет «Участник».
- Вход: иконка «Профиль» в `TopBar` рядом с «Устройствами» (`person.crop.circle` / `account_circle`), обработчик
  `onOpenProfile`.
- Фича `features/profile/` — `useProfile`, `useUpdateProfile` (TanStack Query). После сохранения инвалидировать
  профиль и таблицы результатов гонок.
- Таблица результатов (`features/races/participation-format.ts`, `results-table.tsx`): чужая строка — `riderName ??
  «Участник»`, своя — «Вы» (как сейчас). a11y-подпись строки — с именем. Правка — минимальным отдельным блоком
  (параллельно слайс 06).
- i18n: новые ключи `profile.*` отдельным блоком в `packages/i18n/src/ru.ts`.

**Docs:** `docs/product/` — раздел или файл про профиль (P1–P5); `.claude/rules/pokatim-db.md` — профиль хранит
публичное имя и согласие, удаление аккаунта удаляет документ, снимок протокола имени не хранит.

# 4. Out of Scope

- Клуб, тренер, аватар (P5 — позже).
- Имя в панели «Протокол» (там `Участник ·{id}`): отдельный follow-up с правом на ПДн.
- Удаление аккаунта и «Удалённый участник»: модуля удаления нет. Здесь только правило: удаление аккаунта удаляет
  документ `profiles`, и строка снова анонимна (P4).
- Модерация имён (жалоба на оскорбительную подпись) — follow-up вместе с модерацией пользователей.
- Имя на карточке кофе-райда (`organizerName` остаётся отдельной подписью D2).

# 5. Architecture Context

- `profile` — единственный писатель `profiles` (`ProfileRepository`). Документ — ПДн отдельно от учётки identity.
- `results` получает данные других модулей только через порты (`RACE_REGISTRY` из `races`, `ACTIVITY_SOURCE` из
  `tracks`). `RIDER_NAMES` — тот же паттерн.
- Публичная таблица: `Cache-Control: public, max-age=60`. Смена имени видна не позже чем через минуту, это допустимо.

## 5.1 Placement & Reuse Gate

| Что | Где | Reuse |
|---|---|---|
| схема имени | `contracts/src/profile/profile.schema.ts` | `optionalText`, `SINGLE_LINE` из `common.ts` / ride.schema |
| запись профиля | `ProfileRepository.updatePublicName` | паттерн `upsertSurvey` / `markDevicesStep` |
| порт имён | `profile/rider-names.port.ts` + реализация в `profile` | паттерн `race-registry.port.ts` |
| имя в таблице | `ResultsReadService.publicResults` / `protocolResults` | — |
| экран | `app/settings/profile.tsx`, `features/profile/*` | `useSettingsShell`, формы rides (поля, ошибки) |
| ядро модуля для других | `ProfileCoreModule` в `profile/profile.module.ts` (репозиторий + `RIDER_NAMES`) | паттерн `RacesCoreModule` |
| лимит записи | `profile/profile.policy.ts` (`PROFILE_POLICY.updateLimit`), ключ `profile-update:<uid>` | `RateLimiter` базы, как `RidesService.limit` |
| CORS `PATCH` | `apps/api/src/http-app.ts` (`methods`) | — (первый `PATCH` в API) |
| ошибки полей формы | `features/profile/*` | ключи базы `field.error.{TOO_SHORT,TOO_LONG,INVALID}`, `serverFieldErrors` |

# 6. Relevant Files

- `packages/contracts/src/profile/profile.schema.ts`, `.../results/results.schema.ts`, `.../rides/ride.schema.ts`,
  `.../common.ts`
- `apps/api/src/modules/profile/*`, `apps/api/src/modules/results/{results-read.service.ts,results.module.ts}`
- `packages/api-client/src/index.ts`, `packages/api-client/src/profile.test.ts`
- `apps/app/src/components/top-bar.tsx`, `apps/app/src/app/_layout.tsx`, `apps/app/src/app/(tabs)/index.tsx`,
  `apps/app/src/app/settings/`, `apps/app/src/features/races/{participation-format.ts,results-table.tsx}`
- `packages/i18n/src/ru.ts`

# 7. Implementation Notes

- TDD: схемы (contracts unit), репозиторий/контроллер (`profile.int.test.ts`), таблица с именем
  (`results-read.int.test.ts` / `results-protocol.int.test.ts`), форматирование строки (`participation-format.test.ts`),
  экран (тест экрана по образцу `devices-screen.test.tsx`).
- Имя — ПДн: не логировать (ни тело `PATCH`, ни значения в ошибках). Ошибки валидации отдают только код и путь
  поля, без значения.

# 8. Risks / Assumptions / Open Questions

Решения автора (human gate, 2026-10-26):
- **P1 — необязательно, отдельное согласие.** Имя необязательное. Показ — только при включённой настройке
  «Показывать имя в таблицах результатов» (`showNameInResults`, по умолчанию `false`, opt-in). Нет имени или нет
  согласия — «Участник».
- **P2 — одно свободное поле** 2–80 символов одной строкой (как подпись организатора D2), пример «Анна К.».
- **P3 — всегда текущее имя.** Имени нет в снимке протокола `race_protocol_rows`: таблица читает профиль при каждом
  запросе. Смена имени или отзыв согласия меняет и старые протоколы.
- **P4 — удаление аккаунта** = удаление документа `profiles` → строка «Участник». Чистить снимки не нужно (P3).
  «Удалённый участник» — с модулем удаления аккаунта.
- **P5 — клуб и тренер** — позже.

[ASSUMPTION] Своя строка остаётся «Вы» (имя не подставляется), как в race-results-04.
[ASSUMPTION] Включённая настройка с пустым именем допустима, в таблице «Участник».
Риск: оскорбительные имена публично без модерации — follow-up (§4).

## 8.1 Requirements Consistency (заполняет architect)

Архитектор, 2026-10-26, сверено с кодом `origin/develop` (e047921). **Блокеров нет.** P1–P5 не пересматриваются.

**RC-1. Лимит частоты: образца нет (пробел).** У `PUT /v1/profile/onboarding/survey` и `…/devices` лимита нет
(`OnboardingService` не зовёт `RateLimiter`). Общего лимита записей профиля тоже нет. Фраза §3 «по образцу `PUT …/survey`»
ни к чему не ведёт.
- (а) без лимита — нарушает §8.3;
- (б) общий лимит на все записи профиля, включая опрос и шаг устройств — меняет поведение онбординга, это вне scope;
- (в) **рекомендация:** свой лимит только на `PATCH`.
[ASSUMPTION] `PROFILE_POLICY.updateLimit = { limit: 30, windowSec: 3600 }`, ключ `profile-update:<uid>`. Реализация —
`RateLimiter` базы, как `RidesService.limit`. Превышение — `429 RATE_LIMITED` с `RateLimitedDetails`. Лимит проверяется
после zod (pipe) и до записи. Опрос и шаг устройств не трогаем.

**RC-2. CORS не пускает `PATCH` (конфликт с кодом).** `configureHttp` разрешает только `['GET', 'HEAD', 'POST', 'PUT']`
(`apps/api/src/http-app.ts:29`). `@Patch` в API ещё нет. Web с другого origin (dev `:8081`, любой origin из
`CORS_ORIGINS`) не пройдёт preflight.
- (а) `PUT /v1/profile` — противоречит частичному обновлению из §3;
- (б) `POST /v1/profile` — неидиоматично;
- (в) **рекомендация:** добавить `'PATCH'` в `methods` и проверку preflight `PATCH` в `http-app.test.ts`. Это зона
  security (CORS): coder добавляет пункт в §8.3.

**RC-3. Куда подключать порт (уточнение §3).** `ResultsReadService` объявлен в `ResultsCoreModule`, а его импортирует и
`ResultsWorkerModule` (worker). Провайдер `RIDER_NAMES` нужен в ядре. Иначе DI `WorkerModule` падает, а вместе с ним все
int-тесты: стенд поднимает `AppModule` и `WorkerModule`. `ProfileModule` в ядро results не годится: он тянет `IdentityModule`
и контроллеры в worker.
**Решение:** `ProfileCoreModule` (`ProfileRepository`, `RiderNamesService`, `{ provide: RIDER_NAMES, useExisting }`;
exports `ProfileRepository`, `RIDER_NAMES`, без импортов). Его импортируют `ProfileModule` и `ResultsCoreModule`.
`ProfileRepository` объявляется **только** в ядре: `onboarding.int.test.ts` шпионит за `h.app.get(ProfileRepository)`, и
второй экземпляр сломает тест гонки upsert. Циклов нет: `results → profile → identity`, `profile` не импортирует
`results`/`races`, `identity` — ни одного доменного модуля.

**RC-4. Сборка тестов (снимает вопрос оркестратора).** `results-*.int.test.ts` модуль вручную не собирают: все берут
`createHarness()` (`AppModule` + `WorkerModule`). Отдельно добавлять `ProfileModule` не нужно, достаточно RC-3. Ломаются
точные ожидания формы ответа — их надо обновить:
`profile.int.test.ts` (3 × `toEqual({ rideReasons: [...] })`), `onboarding.int.test.ts:200`, `results-read.int.test.ts:91`
(ключи строки + `riderName`). В приложении — типизированные моки `getProfile.mockResolvedValue({ rideReasons: [] })` в
`home`, `tabs`, `calendar-detail`, `devices-step`, `race-detail`, `ride-detail` (тип выхода `ProfileView` теперь требует
новые поля) и `row()` в `__tests__/races-fixtures.ts` (`riderName: null`).

**RC-5. «Атомарно» и «ответ после записи».** Запись + отдельное чтение — две операции. **Решение:**
`findOneAndUpdate({ _id }, [pipeline], { upsert: true, returnDocument: 'after', projection })` — одна операция, ответ —
документ после записи. Гонка первых upsert — `isDuplicateKey(error, '_id_')` и один повтор, как `OnboardingService.submit`.

**RC-6. Семантика частичного обновления (недоопределено).** Ключа нет в теле — поле не меняется. `publicName: null` или
`""` — в документ пишется `null`. Новый документ: `rideReasons: $ifNull []`, `surveyCompletedAt: $ifNull null`,
`showNameInResults: $ifNull false`, `publicName: $ifNull null`. `devicesStepCompletedAt` не трогаем. `updatedAt` — всегда.
`upsertSurvey` и `markDevicesStep` задают поля явным списком, поэтому имя и согласие не затирают — AC2 закрепляется тестом.

**RC-7. «Хотя бы один ключ».** Корневой `refine` даёт `fields: [{ path: '', code: 'REQUIRED' }]` (`ZodValidationPipe`
базы), в итоге `400 VALIDATION_FAILED`. Проверка — `publicName !== undefined || showNameInResults !== undefined`, а не
`Object.keys`.

**RC-8. Подмена подписи (риск, не блокер).** `SINGLE_LINE` отсекает только `\p{Cc}`. Подписи «Вы», «Участник», символы
`\p{Cf}` (RTL-override, нулевая ширина) проходят.
- (а) **рекомендация:** принять как в D2, модерация — follow-up §4. Своя строка отличается полосой и акцентом
  (`results-table.tsx`), «Вы» в чужой строке не путает визуально;
- (б) отдельный паттерн имени без `\p{Cf}` + зарезервированные слова → `INVALID` — расходится с D2 и с общим
  `SINGLE_LINE`;
- (в) выделить имя курсивом/кавычками — противоречит прототипу.
Риск записать в §8 и в `docs/product/profile.md`.

**RC-9. Кэш таблицы.** `public, max-age=60`: в web инвалидация после сохранения может вернуть ответ из HTTP-кэша
браузера (до 60 с). Это принято в §5. Тесты приложения проверяют факт инвалидации, а не мгновенное имя. Своё имя райдер в
таблице всё равно не видит («Вы», [ASSUMPTION] §8).

**RC-10. Один кэш профиля в приложении.** `PROFILE_QUERY_KEY = ['profile']` уже читает Главная (`useRideReasons`:
`select`, `staleTime: Infinity`), его же инвалидирует онбординг. `useProfile` использует **тот же ключ и тот же
`queryFn`**, без второго ключа. После `PATCH` — `setQueryData(PROFILE_QUERY_KEY, view)` (ответ — полный `ProfileView`,
лишнего запроса нет) + `invalidateQueries({ queryKey: ['races', 'results'] })`.

**RC-11. Длинная подпись в строке таблицы.** 80 символов ломают строку «место · кто · время». **Решение:** `numberOfLines={1}`
(обрезка с многоточием) у `who`, a11y-подпись — полное имя (`rowA11y` уже включает `who`).

**RC-12. ПДн в логах.** Новый `ProfileService.update` ничего не логирует (ни тела, ни имени). Ошибки zod значений не
содержат (`ZodValidationPipe` базы отдаёт только `path` + `code`). В `results` имена не логируются.

**RC-13. Документация шире §10.** `.claude/rules/pokatim-backend.md` (строка про `profile`: `GET`/`PATCH`, порт
`RIDER_NAMES`, `ProfileCoreModule`, лимит `profile-update`) и `pokatim-contracts.md` (`RaceResultRow.riderName` — только с
согласием, `.default(null)`) тоже устаревают — см. §10.

**Решения оркестратора по открытым вопросам (2026-10-26, приняты):**
- RC-1 — принято (в): лимит только на `PATCH /v1/profile`, 30 в час на пользователя, `RateLimiter` как
  `RidesService.limit`, `429 RATE_LIMITED`.
- RC-2 — принято (в): `'PATCH'` в `methods` CORS (`http-app.ts`) + тест preflight; пункт в §8.3.
- RC-8 — принят вариант (б) только для `RiderPublicName` (`RideOrganizerName` не меняется): символы `\p{Cf}` → `INVALID`;
  подписи, совпадающие после trim без учёта регистра с «Вы», «Участник», «Удалённый участник», → `INVALID`. Модерация
  имён — follow-up (§4).

## 8.2 Deviations from spec

- `RiderPublicName` — паттерн `^[^\p{Cc}\p{Cf}]+$` и второй `refine` на служебные подписи (решение RC-8 выше), а не
  чистый конструктор D2.
- `ProfileRepository.findReasons` заменён на `findProfile` (единственный потребитель — `ProfileService`).
- Общий `queryFn` профиля — `fetchProfile`, экспорт из `features/home/queries.ts` (RC-10: один ключ и один запрос).
- Тестовый помощник `call` (`apps/api/test/identity.ts`) принимает `PATCH`.
- Preflight `PATCH` проверяется unit-тестом `http-app.test.ts`, без второго стенда в int.
- Сообщение «Сохранено» — `Banner tone="info"`: тона «успех» у `Banner` базы нет.
- Добавлен тест `top-bar.test.tsx` (порядок иконок «Устройства», «Профиль»).

## 8.3 Security checklist

- [x] `PATCH /v1/profile` — только `AuthGuard`, пользователь из access, id в пути нет (IDOR невозможен).
- [x] Строгая схема тела: лишние ключи → 400; имя — одна строка, без управляющих и форматирующих символов.
- [x] Имя наружу только при `showNameInResults === true`. Порт не отдаёт имена без согласия (согласие — в фильтре).
- [x] Имени нет в логах, ошибках и журнале (`ProfileService` не логирует; ошибка поля — только путь и код, тест).
- [x] Запись в БД — только `$literal`-значения после zod; фильтр — `userId` из access.
- [x] Лимит частоты на `PATCH` (`profile-update:<uid>`, 30/ч).
- [x] `Cache-Control: no-store` на `GET`/`PATCH` профиля.
- [x] CORS (RC-2): `PATCH` добавлен в `methods` только для origin из `CORS_ORIGINS` (credentials как прежде); чужой
  origin preflight не проходит (существующий тест).

# 9. Acceptance Criteria

- AC1: `GET /v1/profile` нового пользователя → `publicName: null`, `showNameInResults: false`, `rideReasons: []`.
- AC2: `PATCH /v1/profile {publicName: "  Анна К. "}` → 200, `publicName: "Анна К."`; повторный `GET` — то же.
  Ответ опроса и флаги онбординга не меняются.
- AC3: `publicName` `"А"` → 400 `TOO_SHORT`; 81 символ → `TOO_LONG`; перевод строки → `INVALID`; `""` / `null`
  → имя очищено.
- AC4: пустое тело `{}` или лишний ключ → 400 `VALIDATION_FAILED`; без access → 401.
- AC5: публичная предварительная таблица: строка райдера с именем и согласием → `riderName: "Анна К."`; с именем
  без согласия, без имени, без документа профиля → `riderName: null`.
- AC6: таблица опубликованного протокола — то же; смена имени после публикации видна в протоколе (P3);
  `race_protocol_rows` поля имени не содержит.
- AC7: отзыв согласия (`showNameInResults: false`) → `riderName: null` в обеих таблицах.
- AC8: приложение — чужая строка с `riderName` показывает имя, без него — «Участник»; своя — «Вы».
- AC9: экран «Профиль» — загрузка, сохранение имени и переключателя, ошибки полей по кодам, ошибка сети с повтором.
  Вход — иконка в верхней панели Главной.
- AC10: `pnpm check` зелёный.

# 10. Documentation Impact

- `docs/product/profile.md` (новый) — P1–P5.
- `.claude/rules/pokatim-db.md` — профиль: публичное имя и согласие, анонимизация, протокол без имени.
- `docs/tasks/2026-10-27-race-results-03-attempts/task.md` не трогать (история); ссылка на этот task — в
  `docs/product/profile.md`.
- (architect) `docs/product/README.md` — ссылка на `profile.md`.
- (architect) `.claude/rules/pokatim-backend.md` — строка о `profile`: `GET`/`PATCH /v1/profile`, лимит `profile-update`,
  порт `RIDER_NAMES` через `ProfileCoreModule`; `results` — имена только через порт, не в снимке протокола.
- (architect) `.claude/rules/pokatim-contracts.md` — `ProfileView`/`RaceResultRow`: новые поля ответа с `.default`,
  `riderName` только при согласии.
- (architect) `docs/product/profile.md` — риск подмены подписи (RC-8) и задержка до 60 с (RC-9).

# 11. Implementation Context

Architect, 2026-10-26. Порядок — TDD по слоям, каждый шаг: красный тест → код → зелёный. Слайс 06 «Споры»
параллельно трогает `results`, `apps/app/src/features/races/*`, `packages/i18n/src/ru.ts`: там правки — **отдельными
компактными блоками**, без переформатирования соседнего кода. Новые int-тесты имён — в **отдельном файле**
`results-names.int.test.ts`.

**ENTRY POINTS**
- `PATCH /v1/profile`, `GET /v1/profile` — `apps/api/src/modules/profile/profile.controller.ts`.
- `GET /v1/races/:raceId/results` — `results-public.controller.ts` → `ResultsReadService.publicResults` (живая ветка и
  `protocolResults`).
- Приложение: `app/(tabs)/index.tsx` → `TopBar.onOpenProfile` → `/settings/profile`.

**FILES TO MODIFY / CREATE**

Contracts (`packages/contracts/src`):
- `profile/profile.schema.ts`:
  ```ts
  export const RIDER_PUBLIC_NAME_MIN = 2;
  export const RIDER_PUBLIC_NAME_MAX = 80;
  export const RiderPublicName = optionalText(RIDER_PUBLIC_NAME_MAX, SINGLE_LINE).refine(
    (value) => value === null || value.length >= RIDER_PUBLIC_NAME_MIN, { error: 'TOO_SHORT' });
  ProfileView = z.object({ rideReasons: …как есть…,
    publicName: z.string().nullable().default(null),
    showNameInResults: z.boolean().default(false) });
  export const UpdateProfileRequest = z.strictObject({
    publicName: RiderPublicName.optional(),
    showNameInResults: z.boolean({ error: fieldError('INVALID') }).optional(),
  }).refine((b) => b.publicName !== undefined || b.showNameInResults !== undefined, { error: 'REQUIRED' });
  export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
  ```
  Импорт `optionalText`, `SINGLE_LINE`, `fieldError` — из `../common.ts`. `RideOrganizerName` не переиспользовать
  напрямую: другой домен, свои константы. Конструктор тот же.
- `results/results.schema.ts` — `RaceResultRow` + `riderName: z.string().nullable().default(null)`. Комментарий: «имя —
  только при явном согласии райдера (P1, profile-rider-name); иначе `null`, приложение — «Участник»».
- `index.ts` — уже реэкспортирует `profile.schema.ts`, правка не нужна.

API, `apps/api/src/modules/profile`:
- `profile.collection.ts` — `ProfileDoc` + `publicName?: string | null; showNameInResults?: boolean;` (необязательные,
  чтение `?? null` / `?? false`; миграции нет).
- `profile.policy.ts` (новый) — `PROFILE_POLICY = { updateLimit: { limit: 30, windowSec: 3600 } } as const` (RC-1).
- `profile.repository.ts`:
  - `updatePublicName(userId: string, patch: { publicName?: string | null; showNameInResults?: boolean }, now: Date):
    Promise<ProfileDoc>` — `findOneAndUpdate({ _id: userId }, [{ $set: … }], { upsert: true, returnDocument: 'after' })`;
    в `$set` — только переданные ключи как `{ $literal }`, плюс `$ifNull` для `rideReasons`/`surveyCompletedAt`/
    `publicName`/`showNameInResults`, `updatedAt: { $literal: now }` (RC-5, RC-6);
  - `findProfile(userId): Promise<Pick<ProfileDoc, 'rideReasons' | 'publicName' | 'showNameInResults'> | null>` — проекция,
    для `view`; `findReasons` либо удалить (единственный потребитель — `ProfileService`), либо оставить. Дубля чтения нет;
  - `findPublicNames(userIds: readonly string[]): Promise<Map<string, string>>` —
    `find({ _id: { $in: userIds }, showNameInResults: true, publicName: { $type: 'string' } }, { projection: { publicName: 1 } })`.
    Согласие — в фильтре, не в коде.
- `rider-names.port.ts` (новый):
  ```ts
  /** Порт `profile` для `results` (через `modules/profile/index.ts`): публичные имена только с согласием (P1). */
  export const RIDER_NAMES = Symbol('RIDER_NAMES');
  export interface RiderNameDirectory {
    /** Только `publicName !== null && showNameInResults === true`; пустой вход — пустая карта без запроса. */
    publicNames(userIds: readonly string[]): Promise<Map<string, string>>;
  }
  ```
- `rider-names.ts` (новый) — `@Injectable() class RiderNamesService implements RiderNameDirectory`: dedupe
  (`[...new Set(ids)]`), пусто → `new Map()`, иначе `repository.findPublicNames`.
- `profile.service.ts` — `view(userId)`: `{ rideReasons: doc?.rideReasons ?? [], publicName: doc?.publicName ?? null,
  showNameInResults: doc?.showNameInResults ?? false }`; `update(userId, body: UpdateProfileRequest): Promise<ProfileView>`:
  `RateLimiter.consume('profile-update:' + userId, PROFILE_POLICY.updateLimit, clock.now())` → `429 RATE_LIMITED`
  (`RateLimitedDetails`); запись с повтором на `isDuplicateKey(error, '_id_')`; ответ — маппинг документа. **Без логов.**
  Зависимости: `RateLimiter` (глобальный провайдер базы, как в `RidesService`), `CLOCK`.
- `profile.controller.ts` — `@Patch() @Header('Cache-Control', 'no-store') update(@CurrentUser() user,
  @Body(new ZodValidationPipe(UpdateProfileRequest, FieldErrorCode)) body)`.
- `profile.module.ts` — `ProfileCoreModule` (providers: `ProfileRepository`, `RiderNamesService`,
  `{ provide: RIDER_NAMES, useExisting: RiderNamesService }`; exports: `ProfileRepository`, `RIDER_NAMES`). Затем
  `ProfileModule` (imports: `IdentityModule`, `ProfileCoreModule`; providers: `OnboardingService`, `ProfileService` —
  **без** `ProfileRepository`, RC-3).
- `index.ts` — `export { ProfileCoreModule, ProfileModule }`, `export { RIDER_NAMES, type RiderNameDirectory } from
  './rider-names.port'`.

API, другие файлы:
- `apps/api/src/http-app.ts` — `methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH']`, комментарий обновить (RC-2).
- `apps/api/src/modules/results/results.module.ts` — `ResultsCoreModule.imports += ProfileCoreModule` (из
  `'../profile'`). Строка в JSDoc ядра: «`RiderNameDirectory` (`profile`)». `ResultsModule` и `ResultsWorkerModule` не
  трогать.
- `apps/api/src/modules/results/results-read.service.ts` — конструктор `+ @Inject(RIDER_NAMES) private readonly names:
  RiderNameDirectory`. Один приватный помощник на обе ветки:
  ```ts
  private async withRiderNames(rows: { userId: string; row: Omit<RaceResultRow, 'riderName'> }[]): Promise<RaceResultRow[]>
  ```
  Один вызов `publicNames(rows.map(r => r.userId))` **после** `withSnapshot` (имя не участвует в согласованности мест).
  Строки собираются явным списком полей: `userId` в ответ не попадает. Живая ветка: `rankedPage` уже отдаёт `userId`
  (проекция `{ _id, userId, best }`). Протокол: `RaceProtocolRowDoc.userId` есть. Строки DQ пропускаются до вызова порта.
  JSDoc `publicResults` — «без ПДн» → «имя — только с согласием (порт `RIDER_NAMES`)». Запросы `ResultsRepository` и
  `buildProtocol` **не менять** (P3: снимок без имени).

api-client:
- `packages/api-client/src/index.ts` — `updateProfile: (accessToken: string, body: UpdateProfileRequest) =>
  request('/v1/profile', ProfileView, authorized(accessToken, { method: 'PATCH', body: JSON.stringify(body),
  ...withCredentials }))` рядом с `getProfile`.

Приложение (`apps/app/src`):
- `features/profile/queries.ts` (новый) — `useProfile()` (ключ `PROFILE_QUERY_KEY` из `features/home/queries`, тот же
  `queryFn`, без `select`), `useUpdateProfile()` (`useMutation`; `onSuccess(view)`: `setQueryData(PROFILE_QUERY_KEY,
  view)` + `invalidateQueries({ queryKey: ['races', 'results'] })`) (RC-10).
- `features/profile/profile-form.tsx` (новый) — `react-hook-form` + `zodResolver` по схеме формы
  `{ publicName: RiderPublicName, showNameInResults: z.boolean() }`. Это та же схема, что поля `UpdateProfileRequest`:
  `UpdateProfileRequest` с корневым `refine` для формы не нужен. `TextField` (подпись, подсказка «Анна К.»), `Toggle` + `Text`
  с пояснением, `Button` (disabled/индикатор на время мутации). Ошибки полей — `field.error.<code>` базы с `{ min:
  RIDER_PUBLIC_NAME_MIN }`, незнакомый код — `field.error.INVALID`. Серверные — `serverFieldErrors(error,
  ['publicName', 'showNameInResults'])`. Прочее — `actionErrorMessage` / `Banner`. Успех — сообщение
  `profile.saved`. Отправляются оба поля.
- `app/settings/profile.tsx` (новый) — по образцу `settings/devices.tsx`: `useSettingsShell()`, `DocumentTitle`,
  «Назад», заголовок сразу. `AsyncContent query={useProfile()}` (скелетон полей, «Нет соединения» / «Не удалось
  загрузить» с повтором), внутри — форма с `defaultValues` из данных.
- `app/_layout.tsx` — `<Stack.Screen name="settings/profile" />` в том же `Stack.Protected`, что `settings/devices`.
- `components/top-bar.tsx` — проп `onOpenProfile?: () => void`. Иконки в `View` (row) справа: «Устройства», затем «Профиль»
  (`{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }`, `accessibilityLabel={t('profile.title')}`).
  Стили — только токены (`size.touchMin`, `space.*`).
- `app/(tabs)/index.tsx` — `onOpenProfile={() => router.push('/settings/profile')}`.
- `features/races/participation-format.ts` — `resultRow`: `who = own ? t('races.results.you') : row.riderName ??
  t('races.results.rider')`. Правка в 1 строку + JSDoc.
- `features/races/results-table.tsx` — `numberOfLines={1}` у текста `who` (RC-11). Правка в 1 строку.
- `packages/i18n/src/ru.ts` — блок `profile.*` (рядом с `devices.*`): `profile.title` «Профиль», `profile.back`
  «Назад», `profile.name.label` «Как вас показывать в результатах», `profile.name.hint` «Например, Анна К.»,
  `profile.show.label` «Показывать имя в таблицах результатов», `profile.show.hint` «Имя увидят все в таблицах
  результатов гонок. Выключите — вы будете «Участник»», `profile.save` «Сохранить», `profile.saved` «Сохранено». Тексты
  ошибок полей — ключи базы, новых не нужно.

**FILES TO READ** (образцы)
- `apps/api/src/modules/races/{race-registry.port.ts,race-registry.ts,races.module.ts,index.ts}` — порт, `useExisting`,
  `*CoreModule`.
- `apps/api/src/modules/profile/{profile.repository.ts,onboarding.service.ts}` — pipeline `$literal`, повтор на `_id_`.
- `apps/api/src/modules/rides/{rides.service.ts (limit),rides.policy.ts,rides.int.test.ts (RATE_LIMITED)}`.
- `apps/api/test/results.ts` (`rider`, `protocolRace`, `protocolAction`, `corridorRace`, `enterRace`) и
  `results-read.int.test.ts` (`standings`, `seedBest`) — подготовка таблиц для `results-names.int.test.ts`.
- `apps/app/src/features/rides/ride-form.tsx` (`fieldText`, `serverFieldErrors`, `Controller` + `TextField`),
  `app/settings/devices.tsx`, `features/devices/settings-shell.tsx`, `__tests__/devices-screen.test.tsx`.
- `@rkarakulov/ui` `Toggle` (`label`, `value`, `onChange`, `disabled`) — описания у него нет, пояснение — отдельный
  `Text` (`meta`).

**TYPES & SCHEMAS**: `RiderPublicName`, `RIDER_PUBLIC_NAME_{MIN,MAX}`, `ProfileView` (+2 поля с `.default`),
`UpdateProfileRequest`, `RaceResultRow.riderName`, `RIDER_NAMES` / `RiderNameDirectory`, `ProfileDoc` (+2 необязательных),
`PROFILE_POLICY`. Коды полей — только существующие базовые (`TOO_SHORT`, `TOO_LONG`, `INVALID`, `REQUIRED`), новых кодов
ошибок нет.

**TDD — порядок шагов**
1. contracts unit: `profile.schema.test.ts` — `RiderPublicName` (trim, 2/80, `\n` → `INVALID`, `""`/`null` → `null`),
   `ProfileView` (старый ответ без полей → `null`/`false`, прежние кейсы целы), `UpdateProfileRequest` (`{}` →
   `REQUIRED` на `''`, лишний ключ, `showNameInResults: "yes"` → `INVALID`, оператор `{ $ne: null }`);
   `results.schema.test.ts` — `RaceResultRow` без `riderName` → `null`, со строкой.
2. api-client: `profile.test.ts` — `updateProfile`: URL, `PATCH`, Bearer, тело, разбор ответа.
3. API profile int (`profile.int.test.ts`): обновить старые `toEqual`, затем AC1–AC4, лимит, `no-store`, гонка первых
   upsert (spy `updatePublicName`, как в `onboarding.int.test.ts`), сохранность опроса и `devicesStepCompletedAt` после
   `PATCH` и наоборот (`PUT …/survey` после `PATCH` не трогает имя).
4. `http-app.test.ts` — preflight `PATCH` разрешён.
5. Порт: int на реальной БД (в `profile.int.test.ts` или `rider-names.int.test.ts`) — `h.app.get(RIDER_NAMES)`:
   пустой вход без запроса (spy на `findPublicNames` не вызван), только согласные с именем, дубли id.
6. Results int (`results-names.int.test.ts`, новый) — AC5–AC7; правка ключей в `results-read.int.test.ts:91`.
7. App unit: `participation-format.test.ts` (AC8) → `profile-screen.test.tsx` (AC9) → `home.test.tsx` (иконка ведёт на
   `/settings/profile`); фикстуры и моки по RC-4.
8. Docs (§10), `pnpm check`.

**TESTS — матрица по AC**

| AC | Уровень | Файл | Проверка |
|---|---|---|---|
| AC1 | int (Mongo) | `profile.int.test.ts` | новый → `{ rideReasons: [], publicName: null, showNameInResults: false }`; документ шага устройств без полей — то же |
| AC2 | int | `profile.int.test.ts` | `"  Анна К. "` → `"Анна К."`, `GET` то же; документ: `rideReasons`, `surveyCompletedAt`, `devicesStepCompletedAt` прежние, `updatedAt` = `CLOCK`; без документа — создан с `rideReasons: []`, `surveyCompletedAt: null`; onboarding-статус не изменился |
| AC3 | unit + int | `profile.schema.test.ts`, `profile.int.test.ts` | `"А"` → `TOO_SHORT`, 81 → `TOO_LONG`, `\n` → `INVALID` (`fields[].path === 'publicName'`, значения в теле ответа нет); `""` и `null` → `publicName: null` |
| AC4 | int | `profile.int.test.ts` | `{}`, `{ userId }`, `{ publicName: { $ne: null } }` → 400 `VALIDATION_FAILED`, документ не создан; без access → 401; 31-й `PATCH` за час → 429 `RATE_LIMITED` + `retryAfterSec`; `no-store` на `GET` и `PATCH` |
| AC5 | int | `results-names.int.test.ts` | предварительная таблица из 4 райдеров: имя+согласие → `riderName`; имя без согласия, согласие без имени, без документа → `null`; `Object.keys` строки = 5 ключей, `userId` нет |
| AC6 | int | `results-names.int.test.ts` | опубликовать (`protocolRace` + `protocolAction`), затем `PATCH` имени → новое имя в `status: 'final'`; `race_protocol_rows` — ключи документа без `riderName`/`publicName` |
| AC7 | int | `results-names.int.test.ts` | `showNameInResults: false` → `null` в живой и в протокольной таблицах |
| AC8 | unit | `participation-format.test.ts` | чужая с `riderName` → имя и a11y с именем; без → «Участник»; своя с `riderName` → «Вы» |
| AC9 | RNTL | `__tests__/profile-screen.test.tsx` | скелетон → данные; сохранение имени и переключателя (тело `updateProfile`); клиентские `TOO_SHORT`/`INVALID` без запроса; серверный 400 по коду; ошибка сети при загрузке → «Нет соединения» + повтор; сохранение — кнопка disabled; успех — сообщение; кэш `['profile']` обновлён, `['races','results']` инвалидирован |
| AC9 | RNTL | `home.test.tsx` | иконка «Профиль» в `top-bar` → `/settings/profile` |
| AC10 | gate | — | `pnpm check` (format, lint, `arch:check` — без циклов, typecheck, test) |

Отрицательные доказательства (результат — в §12): (1) убрать `showNameInResults: true` из фильтра
`findPublicNames` → AC5 «имя без согласия» краснеет по значению; (2) убрать `ProfileCoreModule` из `ResultsCoreModule`
→ стенд не поднимается (DI worker), задокументировать одной строкой.

**OUT OF SCOPE**: лимит опроса и шага устройств (RC-1); имя в панели «Протокол»; удаление аккаунта; модерация имён;
`organizerName` райдов; любые изменения `buildProtocol`, `race_protocol_rows`, миграций, индексов, outbox и BullMQ
(асинхронности нет); SSR/loader экрана профиля (экран не публичный).

**НА ЧТО СМОТРЕТЬ РЕВЬЮЕРУ**
- `userId` не утекает в публичную строку (явный список полей, тест ключей).
- Порт вызывается один раз на страницу, вне транзакции; пустая страница — без запроса.
- `ProfileRepository` — один экземпляр (только `ProfileCoreModule`).
- Значения в pipeline — только `$literal`; фильтр — `userId` из access.
- Ни имени, ни тела `PATCH` нет в логах.
- Правки в `results`, `features/races`, `ru.ts` — минимальными блоками (конфликты со слайсом 06).
- Все платформы: экран без `Platform.OS`, иконки через `expo-symbols`, web — `PATCH` проходит CORS.

# 12. Outcome (заполняет coder)

Coder, 2026-10-26. Изменения в рабочем дереве, без коммита.

**Сделано (AC1–AC10):**
- Contracts: `RiderPublicName` (+ RC-8: `\p{Cf}` и служебные подписи → `INVALID`), `RIDER_PUBLIC_NAME_{MIN,MAX}`,
  `ProfileView` + `publicName`/`showNameInResults` (`.default`), `UpdateProfileRequest` (strict, корневой `REQUIRED`),
  `RaceResultRow.riderName` (`.nullable().default(null)`).
- api-client: `updateProfile` → `PATCH /v1/profile`.
- API `profile`: `ProfileCoreModule` (`ProfileRepository`, `RiderNamesService`, `RIDER_NAMES`), `PATCH /v1/profile`
  (`no-store`, лимит `profile-update` 30/ч, upsert `findOneAndUpdate` + `$literal`, повтор на `_id_`), `GET` с новыми
  полями, `findPublicNames` с согласием в фильтре; `profile.policy.ts`, `rider-names.port.ts`, `rider-names.ts`.
  Логов нет.
- API `results`: `ResultsCoreModule` импортирует `ProfileCoreModule`; `publicResults` и `protocolResults` — один вызов
  `publicNames` после snapshot-сессии (`withRiderNames`), строка — явным списком полей. Запросы `ResultsRepository` и
  `buildProtocol` не менялись.
- CORS: `PATCH` в `methods` (`http-app.ts`).
- Приложение: экран `settings/profile.tsx` (гард `useSettingsShell`, `AsyncContent`), `features/profile/{queries.ts,
  profile-form.tsx}`, иконка «Профиль» в `TopBar` (Главная), `Stack.Screen settings/profile`; `resultRow` — `riderName ??
  «Участник»`, своя «Вы»; `numberOfLines={1}` у `who`. i18n — блок `profile.*`.
- Docs: `docs/product/profile.md` (новый), `docs/product/README.md`, `.claude/rules/pokatim-{db,backend,contracts}.md`.

**Тесты:** `profile.schema.test.ts`, `results.schema.test.ts`, `api-client/profile.test.ts`, `http-app.test.ts`
(preflight `PATCH`), `profile.int.test.ts` (AC1–AC4, лимит, гонка upsert, порт), `onboarding.int.test.ts`
(форма ответа), `results-names.int.test.ts` (новый, AC5–AC7), `results-read.int.test.ts` (ключи строки),
`participation-format.test.ts` (AC8), `profile-screen.test.tsx` (новый, AC9), `home.test.tsx` и `top-bar.test.tsx`
(иконка), моки `getProfile` и `row()` по RC-4.

**Отрицательные доказательства:**
1. Убран `showNameInResults: true` из фильтра `findPublicNames` → `results-names.int.test.ts` 3 failed по значению
   (`- null / + "Скрытый"`; AC7 `expected 'Анна К.' to be null`). Возвращено.
2. Убран `ProfileCoreModule` из `ResultsCoreModule` → стенд не поднимается: `Nest can't resolve dependencies of the
   ResultsReadService (…, ?). Please make sure that the argument Symbol(RIDER_NAMES) at index [4] is available in the
   ResultsCoreModule module.` Возвращено.

**Проверки:**
- `MONGO_URL_TEST=…/pokatim_profile_test… REDIS_URL_TEST=redis://127.0.0.1:6479/9 TURBO_CONCURRENCY=1 pnpm check` →
  exit 0: format:check, lint, `arch:check` (`✔ no dependency violations found (926 modules, 3205 dependencies
  cruised)`), typecheck, test — `Tasks: 13 successful, 13 total`. Тесты: contracts 206, api-client 69, api 864
  (87 файлов), app 851, admin 189, tracks 202, design-tokens 114, i18n 6 — все passed.

**Риски / follow-up:** модерация имён (RC-8); имя в панели «Протокол»; задержка до 60 с из-за публичного кэша (RC-9).

## Независимое ревью

- Pass 1 (Claude `independent-reviewer`, рабочее дерево) — **APPROVE**: CRITICAL 0 / HIGH 0 / MEDIUM 2 / LOW 3.
  Закрыто автором: `pokatim-security.md` (строки таблицы — имя только с согласием), «ё» = «е» в служебных подписях
  (+ тест), устаревшие «анонимная таблица» в JSDoc и `races-and-seasons.md`, баннер «Сохранено» скрывается при
  правке формы. MEDIUM «учёт согласия без даты и версии» — follow-up в `docs/product/profile.md`.

- Слияние develop (06 «Споры»): имя соперника — и в кнопке строки (`disputes.rival.open` с `{who}`), и на карточке
  соперника (`RivalResult`), тест в `race-disputes.test.tsx`.
