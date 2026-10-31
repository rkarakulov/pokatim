# task.md — фото организатора кофе-райда (ride-photo)

Уровень: task3. Ветка: `feature/organizer-photo` от `origin/develop`. PR — в `develop`.

## 1. Title

Фото организатора на кофе-райде: загрузка, показ (герой ленты/Главной, карточка-приглашение 4a), модерация, стирание.

## 2. Goal

Закрыть отложенный follow-up «Фото организатора на 4a — модуль `media`» (`docs/product/rides.md` «Скрыто»,
ADR-0018 «`night` — 4a без фото», `docs/tasks/2026-10-28-ride-invite-card` §4, `2026-10-27-app-05-rides` §4):
организатор добавляет к своему райду фото, оно лежит под измеренным затемнением на герое райда и на карточке-приглашении
4a, команда может его снять, при удалении аккаунта оно стирается.

Источник UX — прототип `key-rides.html` (d) и `key-home.html`: «фото организатора · плейсхолдер» на герое ленты и
Главной; экран карточки-приглашения — «Добавить своё фото» (без фото — карточка с линией маршрута), с фото — «Фото Кати
под затемнением, «Заменить фото»».

## 3. Scope

### Решение по архитектуре: общий конвейер изображений, хранение — у владельца (рекомендация)

Рассмотрены варианты:

| Вариант | Плюсы | Минусы |
|---|---|---|
| (A) Общий модуль `media`: коллекция `media_images` с `ownerKind/ownerId`, общие загрузка/отдача/модерация/стирание | одна точка для будущих обложек гонок и галереи | владелец, права, видимость (скрытый райд), модерация и стирание — доменные; общий модуль либо знает о райдах/профилях (цикл), либо требует портов на каждое правило; «на вырост» (`AGENTS.md` §4.9) |
| (B) Копия механизма аватара в `rides` | быстро | второй sharp-конвейер и **второй семафор обработки**: пик памяти удваивается (ADR-0019 считал запас под 512 МБ при одной обработке на процесс), дублирование ~250 строк с тонкой безопасностью |
| **(C) Общий конвейер изображений + хранение у владельца** | один sharp-конвейер, **один семафор на процесс** для всех фото, одна отдача байтов с безопасными заголовками; права, видимость, модерация и стирание — в модуле владельца, единственный писатель коллекции — его репозиторий | небольшой рефактор аватара (поведение и контракт без изменений) |

**Выбрано (C)** [ASSUMPTION]: `apps/api/src/media/` (инфраструктура рядом с `upload-slots.ts` и `raw-body.ts`, не
доменный модуль): сигнатура формата, лимиты пикселей, две стадии sharp (квадрат аватара и «вписать» обложки), общий
`ImageProcessingGate` (1 обработка на процесс на все фото), хелпер отдачи JPEG. Профиль и райды используют его;
`profile_avatars` не трогается, для райдов — новая коллекция `ride_photos` (писатель — репозиторий `rides`). ADR-0028.

### Продуктовые решения (все `[ASSUMPTION]`, по прототипу и рядом стоящим решениям)

- **P1. Фото — у райда, не у аккаунта.** Прототип: «Добавить своё фото» на экране карточки конкретного райда. Одно фото
  на райд; замена — новый id, прежнее удаляется.
- **P2. Кто и когда загружает.** Только организатор; райд опубликован, не скрыт, ещё не начался (как правка, Q10).
  Удалить своё фото — всегда (в т. ч. отменённый/прошедший/скрытый райд).
- **P3. Где в приложении.** Экран карточки-приглашения (`ride-invite-screen`): у организатора «Добавить своё фото» /
  «Заменить фото» / «Удалить фото»; с фото шаблон `night` рисуется 4a «фото под затемнением». Остальным — без кнопок.
- **P4. Где видно.** Герой райда в ленте «Кофе-райды» и на Главной (ближайший райд) — фото под затемнением вместо
  типографского героя; карточка-приглашение `night` (4a). Деталь райда, список по дням, OG-картинка — без фото
  (follow-up: OG и шапка детали).
- **P5. Обработка.** Без обрезки на клиенте: сервер поворачивает по EXIF, вписывает в 1600 px по длинной стороне
  (`fit: inside`, без увеличения), JPEG без метаданных (EXIF/GPS стираются); короткая сторона < 400 px — 422.
  Входные лимиты — как у аватара (10 МиБ, JPEG/WebP ≤ 100 Мп, PNG ≤ 25 Мп, таймаут 10 с). Кадрирование под герой и 9:16 —
  `cover` при показе/рендере (центр).
- **P6. Видимость байтов.** `GET /v1/ride-photos/:id` без входа (как аватар: случайный id, `immutable`); пока райд
  скрыт — 404 всем (в т. ч. организатору: в карточке скрытого райда фото не показываем).
- **P7. Модерация.** «Удалить фото» в карточке райда панели (`rides.moderate`, причина) → документ удалён, URL 404,
  журнал `ride.photo_reset`. Скрытие райда целиком — уже есть (05b). Запрет повторной загрузки — не делаем (follow-up,
  если появится злоупотребление).
- **P8. Стирание.** Удаление аккаунта стирает все фото его райдов (шаг `rides`, ADR-0015) и обнуляет ссылку на райдах.
- **P9. Лимиты.** 20 загрузок фото райда в час на пользователя; слоты приёма — 4 на процесс, 1 на пользователя;
  обработка — общий семафор с аватаром.

### Разбиение на PR

- **PR A (API)** — `media` (вынос конвейера и семафора из профиля, поведение аватара то же), `ride_photos` +
  миграция, `PUT /v1/rides/:id/photo`, `POST /v1/rides/:id/photo/delete`, `GET /v1/ride-photos/:id`, `photo` во view
  райда (лента, деталь, герой), сброс модератором, стирание, рендер 4a с фото в `sharing`, ADR-0028, доки.
- **PR B (приложение)** — загрузка/замена/удаление на экране карточки, фото на герое ленты и Главной, превью 4a.
- **PR C (панель)** — фото в карточке райда модерации и «Удалить фото».

## 4. Out of Scope

- Фото у аккаунта организатора/клуба (имя и фото организатора-человека — «Свои», `social.md`).
- OG-картинка райда с фото, шапка детали райда с фото, обложки гонок и галерея (тот же `media`, следующие блоки).
- Обрезка на клиенте, несколько фото, запрет повторной загрузки, жалоба «на фото» отдельной причиной.
- S3/CDN (ADR-0019: при переезде меняются только репозиторий и отдача).

## 5. Architecture Context

Architecture Review (architect, 2026-10-31) — **Status: CONCERNS** (блокеров нет; решения по 8.1 R1–R8 — до кода,
рекомендации ниже приняты как `[ASSUMPTION]`, если человек не возразит).

**Как устроено сейчас (проверено кодом).**
- Аватар (ADR-0019): `profile/avatar-image.ts` — сигнатура, заголовок, предел пикселей по формату, две стадии sharp
  (`autoOrient` + `fit: inside` 2048 → `extract` квадрата → 512 JPEG q82), `sharp.cache(false)`, `concurrency(1)`;
  `avatar-processing-gate.ts` — `AvatarProcessingGate` + `@Injectable AvatarProcessing` (провайдер **`ProfileModule`**,
  только API-процесс, лимиты `PROFILE_POLICY.avatarProcessing {1, 5000}`); слоты приёма — `new UploadSlots(
  PROFILE_POLICY.avatarSlots)` **полем сервиса** (`ProfileAvatarService`), не провайдер; отдача — `AvatarsPublicController`
  (заголовки после чтения через `HttpAdapterHost`, `PublicReadGuard`).
- Райды: права — `ownRide` (чужой/неизвестный → 404, не 403), `assertUpcoming` (`ridePhase` ≠ `upcoming`, в т. ч.
  `hidden` → 409 `RIDE_INVALID_STATE`); видимость — `visibleTo` (скрытый — только организатору). View — `summaryOf` в
  `rides-feed.service.ts` (общий для `RideCard` ленты/Главной, `RideDetail` публичной карточки, `RideView` `me`/мутаций);
  проекции репозитория (`PUBLIC_PROJECTION`, viewer, feed, moderation) — явные. Модерация — транзакция «условная запись
  райда первой → жалобы → outbox → `PanelAudit.append`» (`rides-moderation.service.ts`), subject `ride`, label — название.
- Приглашение: `RideInviteInputs.resolve` → порт `RIDES_FOR_SHARING.inviteFacts` (скрытый — 404 всем) → `rideInviteHash`
  (явный канонический массив) → задача `ride-invite.render` (только id и хэш); worker (`StoryCardProcessor`,
  `concurrency: 1`) пересчитывает входы, сверяет хэш, тянет линию `inviteLine`, рендерит satori → resvg → PNG
  (`maxPngBytes` 2 МБ) в Redis. OG-хэш (`og-card.inputs.ts`) берёт поля фактов явно — новое поле фактов OG не задевает.
- Стирание: `AccountErasureService` шаг `rides` → `RideErasure.erase` (лог `cancelled= left= unsigned= restarted=`).

**Целевая схема PR A.**
1. **`apps/api/src/modules/media/`** (не `src/media/`, см. 8.1 R1) — инфраструктурный модуль без коллекций и без
   импортов других модулей (лист): `image-format.ts`, `image-pipeline.ts`, `image-processing.ts` (гейт), `image-reply.ts`
   (отдача JPEG), `media.policy.ts`, `media.module.ts`, `index.ts`.
   - `detectImageFormat(bytes): ImageFormat | null` (перенос как есть).
   - `inspectImage(bytes, limits): Promise<{ ok: true; format; oriented: { width; height } } | ImageFailure>` — сигнатура →
     `metadata()` (формат декодера = сигнатуре, предел пикселей по формату, размеры после ориентации).
   - `processCover(bytes, { maxEdgePx: 1600, minShortPx: 400 }): Promise<ImageResult>` — `inspectImage` → одна стадия
     `autoOrient().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 })
     .timeout(10 s)`; короткая сторона **результата** < 400 → `too_small` (8.1 R4); результат — `{ ok, bytes, format,
     width, height }`.
   - Для аватара — `decodeOriented(bytes, format, edgePx)` (стадия 1 в raw) экспортируется ядром; `processAvatar`,
     `cropRect`, `scaleRect` остаются в `profile/avatar-image.ts` поверх ядра (публичные имена и поведение те же;
     `detectImageFormat` реэкспортируется оттуда же для старых импортов).
   - Общие настройки (`sharp.cache(false)`, `sharp.concurrency(1)`, `failOn: 'error'`, `animated: false`,
     `sequentialRead`, пределы JPEG/WebP 100 Мп / PNG 25 Мп, таймаут 10 с) — **только** в `image-pipeline.ts`.
     `ImageFailure = { ok: false; error: 'unsupported' | 'invalid' | 'too_small'; format? }`; аватар сводит `too_small`
     к `invalid` (как сейчас).
   - `ImageProcessingGate` (перенос `AvatarProcessingGate` без изменений) + `@Injectable() ImageProcessing` с
     `MEDIA_POLICY.processing = { concurrency: 1, waitMs: 5_000 }`; `@Injectable() ImageUploadSlots extends UploadSlots`
     с `MEDIA_POLICY.uploadSlots = { maxTotal: 4, maxPerUser: 1 }` (общие для аватара и фото райда, 8.1 R2).
   - `MediaModule` (`@Module({ providers: [ImageProcessing, ImageUploadSlots], exports: [...] })`, **не** `@Global`):
     импортируют `ProfileModule` и `RidesModule` — Nest создаёт статический модуль один раз на приложение, оба получают
     **один** экземпляр гейта и слотов. В worker не импортируется (рендеру гейт не нужен: очередь `story-card` —
     `concurrency: 1`).
   - `replyJpeg(adapter, reply, bytes, cacheControl)` — `Content-Type: image/jpeg`, `Cache-Control`, `nosniff`,
     `CSP: default-src 'none'; sandbox`; аватар переходит на него (заголовки те же).
2. **`rides`**: коллекция `ride_photos` (писатель — `RidePhotosRepository` в `RidesCoreModule`, единственный),
   поле `RideDoc.photoId?: string | null`; `RidePhotosService` (загрузка/удаление/байты), `RidePhotosController`
   (`rides/:id/photo`, `AuthGuard`), `RidePhotosPublicController` (`ride-photos`, `PublicReadGuard`), действие модерации
   «Удалить фото», шаг стирания, порт `RIDES_FOR_SHARING` расширен.
3. **`sharing`**: `photoId` в фактах и в хэше (только `night`), worker тянет байты через порт, композиция sharp.

**Права, состояния, коды (PR A).**
| Запрос | Порядок проверок | Ответ |
|---|---|---|
| `PUT /v1/rides/:id/photo` (octet-stream ≤ 10 МиБ) | `Uuid` pipe → `admit`: `ownRide` (нет/чужой — 404) → `assertUpcoming` (прошедший/отменённый/скрытый — 409 `RIDE_INVALID_STATE`) → слот (`429`, `retryAfterSec: 5`) → лимит `ride-photo:<uid>` 20/ч (429) — всё **до тела**, отказ — `Connection: close`; → `readLimited` (415 `IMAGE_FORMAT_UNSUPPORTED` / 413 `IMAGE_TOO_LARGE` / 408) → гейт (429) → `processCover` (415 / 422 `IMAGE_INVALID`) → транзакция | `200 RideView` (`ride.photo.id`), `version` не меняется |
| `POST /v1/rides/:id/photo/delete` | лимит `rides-manage` → транзакция по `{ _id, organizerUserId }` (любой статус) → нет/чужой — 404 | `200 RideView`, идемпотентно |
| `GET /v1/ride-photos/:id` | `RidePhotoId` pipe (400) → документ фото → райд `{ _id: rideId, photoId: id, status: { $ne: 'hidden' } }` → иначе 404 JSON | `image/jpeg`, `public, max-age=86400, immutable` (8.1 R6), `nosniff`, `sandbox` |
| `POST /v1/admin/rides/:id/photo-reset` (`rides.moderate`) | тело `{ photoId, reason }` → транзакция: условная запись райда `{ _id, photoId }` первой → удаление `ride_photos` → `PanelAudit` `ride.photo_reset` | `200 ModerationRideDetail`; фото уже другое — 409 `CONFLICT`; фото нет — 200 без журнала |

**Транзакция замены** (`MongoTransactions.run`): (1) `findOneAndUpdate` райда `{ _id, organizerUserId, status:
'published', startsAt: { $gt: now } }` → `$set { photoId: newId, updatedAt: now }`, `returnDocument: 'before'`
(запись райда первой — гонка со сбросом модератора/правкой даёт write conflict и повтор); `null` → вне транзакции
классификация по свежему чтению (`ownRide` → 404, иначе 409); (2) `deleteOne({ _id: prev, rideId })`, если был; (3)
`insertOne` нового (уникальный `{ rideId }` — порядок «удалить → вставить» обязателен). `version` не трогается
(открытая форма правки не получит 409), `updatedAt` — да (og.sync пересчитает хэш, он не изменится — без рендера).
**Удаление** — та же схема с `$set { photoId: null }` и без вставки.

**View.** `summaryOf` → `photo: doc.status !== 'hidden' && doc.photoId ? { id: doc.photoId } : null` — попадает в
ленту/Главную (`RideCard`), `me`/мутации (`RideView`), публичную карточку (`RideDetail`; показывать ли — решает клиент,
P4). Скрытый — `null` всем, включая организатора (согласовано с 404 на отдаче). `photoId` добавить во все проекции
репозитория, где строится view (`PUBLIC_PROJECTION`, viewer, feed); в moderation-проекцию — для `ModerationRideDetail.photo`.

**Рендер 4a с фото (worker).** `RideInviteFacts.photoId: string | null` (`inviteFacts` и `ogFacts` заполняют; OG поле не
использует). `rideInviteHash` — `+ (template === 'night' ? facts.photoId : null)`, `STORY_CARD_POLICY.renderVersion`
3 → 4. Порт: `invitePhoto(rideId, photoId): Promise<Uint8Array | null>` — байты, только если райд не скрыт и
`ride.photoId === photoId` (иначе `null` → процессор считает вход устаревшим, как при несовпадении хэша; ретраить
нечего). Композиция (`ride-invite.png.ts`): (a) `sharp(photo).resize(1080, 1920, { fit: 'cover', position: 'centre' })`;
(b) затемнение — композит слоя-скрима (градиент из токена, 8.1 R7); (c) текстовый слой — тот же `nightCard` с прозрачным
фоном страницы (satori → resvg PNG RGBA); (d) `composite` → `png({ palette: true, quality: 80, effort: 7, dither: 1 })`,
проверка `maxPngBytes` (2 МБ, 8.1 R5). Байты фото не идут через SVG/base64. Пик памяти worker: фото ≤ 1600 px (~6 МБ
RGB) + 3 буфера 1080×1920 RGBA (~25 МБ) — в пределах; `sharp.cache(false)` действует и в worker (настройки — в
`media/image-pipeline.ts`, импорт из `ride-invite.png.ts`).

**Стирание (ADR-0015, шаг `rides`).** `RideErasure.erase`: после `clearOrganizerName` — `clearPhotosOf(userId)`
(`updateMany({ organizerUserId, photoId: { $type: 'string' } }, { $set: { photoId: null } })`) затем
`RidePhotosRepository.deleteAllOf(userId)` (индекс `{ organizerUserId }`); результат `photos: number`, лог шага
`… photos=N`. Все райды организатора, включая скрытые и прошедшие. Повтор — no-op.

## 5.1 Placement & Reuse Gate (обязательно)

- **Placement.** `apps/api/src/modules/media/` — инфраструктура изображений (Nest-модуль-лист: без коллекций, без
  импортов `modules/*`); потребители — `profile`, `rides` (API) и `sharing` (worker, только чистые функции) через
  `modules/media/index.ts`. Фото райда — модуль `rides` (контроллеры, сервис, репозиторий, политика, модерация,
  стирание); рендер — `sharing`. Новый пакет не нужен (один потребитель-приложение — `apps/api`). В app-foundation не
  выносим: конвейер привязан к sharp, политике памяти и контрактам pokatim; кандидат в базу — только если второй проект
  попросит (зафиксировать в ADR-0028 «Последствия»).
- **Reuse (обязательно, без копий).** `readLimited` + `DEFAULT_*`/свои таймауты (`raw-body.ts`), `UploadSlots`
  (`upload-slots.ts`, наследник-провайдер в `media`), гейт обработки (перенос из `profile`), `randomToken` (`identity`),
  `RateLimiter`/`CLOCK`/`MongoTransactions`/`MongoOutboxWriter`, `PanelAudit` (`panel`), `PublicReadGuard`,
  `ownRide`/`assertUpcoming`/`visibleTo`/`ridePhase` (`rides.policy`/`rides.service` — вынести `ownRide` и
  `assertUpcoming` в общий хелпер rides или вызывать через `RidesService`, не копировать), `summaryOf`/`rideViewOf`
  (`rides-feed.service.ts`), `ActionReason` (contracts admin), `OpaqueToken` (вынести из `profile/rider-avatar.schema.ts`
  в `common.ts`; `AvatarId` = он же), `test/avatars.ts` (фикстуры `twoToneImage`, `hugePng`, `brokenJpeg`, `hasGpsIfd`,
  `GIF_BYTES`), `storyCard`/`overlay.scrim`/`onPhoto` (`@pokatim/design-tokens`).
- **Запрещённые дубли.** Второй вызов `sharp.cache/concurrency`, второй гейт или второй экземпляр `ImageProcessing`
  (провайдер только в `MediaModule`; `ProfileModule`/`RidesModule` его не объявляют), свой `UploadSlots` в сервисе фото,
  своя установка заголовков отдачи JPEG, копия `detectImageFormat`/пределов пикселей, копия проверки «свой будущий
  райд», ручной DTO вне `packages/contracts`.

## 6. Relevant Files

**PR A — создать.**
- `apps/api/src/modules/media/{index.ts, media.module.ts, media.policy.ts, image-format.ts, image-pipeline.ts,
  image-processing.ts, image-reply.ts}` + тесты `image-format.test.ts`, `image-pipeline.test.ts` (cover),
  `image-processing.test.ts` (перенос `avatar-processing-gate.test.ts`).
- `apps/api/src/modules/rides/{ride-photos.collection.ts (или в rides.collection.ts), ride-photos.repository.ts,
  ride-photos.service.ts, ride-photos.controller.ts, ride-photos-public.controller.ts}`, int-тесты
  `ride-photos.int.test.ts`, `ride-photos-moderation.int.test.ts` (или кейсы в `rides-moderation.int.test.ts`).
- `apps/api/src/db/migrations/0047_ride_photos.ts` (номер сверить с `origin/develop` перед PR, 8.1 R8).
- `docs/adr/0028-image-pipeline-and-ride-photos.md`.

**PR A — изменить.**
- `apps/api/src/modules/profile/{avatar-image.ts, profile-avatar.service.ts, avatars-public.controller.ts,
  profile.module.ts, profile.policy.ts}`; удалить `avatar-processing-gate.ts(+test)` после переноса; в
  `profile-avatar.int.test.ts` — только импорты/имена (`ImageProcessing`, `MEDIA_POLICY.processing`), ожидания те же.
- `apps/api/src/modules/rides/{rides.collection.ts, rides.repository.ts, rides-feed.service.ts (summaryOf, проекции),
  rides.service.ts (вынос ownRide/assertUpcoming при необходимости), rides.policy.ts (RIDES_POLICY.photoUploadLimit,
  photoBodyTimeouts), rides-moderation.{service,controller}.ts, ride-erasure.ts, rides-for-sharing.{ts,port.ts},
  rides.module.ts, index.ts}`.
- `apps/api/src/modules/sharing/{ride-invite.inputs.ts, ride-invite.png.ts, ride-invite.render.ts (прозрачный фон
  night-с-фото), story-card.processor.ts (buildRideInvite), sharing.policy.ts (renderVersion 4)}`.
- `apps/api/src/modules/account/account-erasure.service.ts` (лог шага `photos=`).
- `apps/api/src/db/migrations/{index.ts, migrations.int.test.ts}`, `apps/api/src/error-messages.ts`.
- `packages/contracts/src/{common.ts (OpaqueToken, IMAGE_* коды), profile/rider-avatar.schema.ts (AvatarId =
  OpaqueToken), rides/ride.schema.ts (RidePhotoId, RIDE_PHOTO_* константы, RideSummary.photo, ImageInvalidDetails),
  rides/ride-moderation.schema.ts (ModerationRideDetail.photo, ResetRidePhotoRequest), admin/audit.schema.ts
  ('ride.photo_reset' в конец)}` + `*.schema.test.ts`.
- `packages/api-client/src/{index.ts (uploadRidePhoto, ridePhotoUploadRequest, deleteRidePhoto, ridePhotoUrl), admin.ts
  (resetRidePhoto, ridePhotoUrl)}` + тесты.
- `packages/i18n/src/ru.ts` (`admin.audit.action.ride.photo_reset`; тексты `IMAGE_*` для приложения — можно в PR B).
- `packages/design-tokens/src/...` (токен скрима фото для 4a и героя, 8.1 R7) + тест контраста.
- Доки: `docs/adr/README.md`, ADR-0018 (4a с фото), ADR-0015 (шаг `rides` стирает фото), ADR-0011/ADR-0019 (ссылка на
  ADR-0028 как второе исключение «файлы наружу»), `docs/product/rides.md`, `docs/product/admin-panel.md` (действие API),
  `.claude/rules/pokatim-security.md` (раздел «Фото райда и media», строка 82 — исключения), `.claude/rules/pokatim-db.md`
  (коллекция `ride_photos`, писатель), `.dependency-cruiser.cjs` (`media-leaf`).

**Прочитать перед кодом.** `profile-avatar.service.ts`, `profile-avatars.controller.ts`, `avatars-public.controller.ts`,
`profile-avatar.int.test.ts`, `profile-avatar-locks.int.test.ts`, `rides.service.ts`, `rides-feed.service.ts`,
`rides.repository.ts` (проекции, `findForViewer`, `cancel`), `rides-moderation.service.ts`, `rides-hidden.int.test.ts`,
`ride-invite.int.test.ts`, `story-card.processor.ts`, `story-card.png.ts`, `test/avatars.ts`, `test/rides.ts`,
`db/migrations/0033_rider_profile.ts` (образец), ADR-0019, ADR-0018 §«Приглашение».

## 7. Implementation Notes

- Новая нативная зависимость не нужна: `expo-image-picker` и `expo-image` уже в приложении (PR #97).
- `version` райда загрузка фото не меняет (открытая форма правки не получает конфликт); в ключ кэша приглашения
  входит id фото.

## 8. Risks / Assumptions / Open Questions

- Все продуктовые решения P1–P9 — `[ASSUMPTION]` по прототипу; вопросов к пользователю нет.
- Документ ≈ 150–400 КБ JPEG 1600 px — в пределах документа MongoDB; копий в транзакциях нет.
- Рендер 4a тянет байты фото в worker `story-card` (порт `rides`), память рендера — проверить.
- `immutable`-кэш браузеров держит снятое фото до очистки кэша — принятый риск (как ADR-0019).

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Находки — с рекомендацией (принимается как `[ASSUMPTION]`, если человек не решит иначе):

- **R1. Место `media`.** §3 говорит `apps/api/src/media/`, а `pokatim-security.md` уже держит в `paths:`
  `apps/api/src/modules/media/**`; у Nest-модуля с провайдерами граница через `index.ts` проверяется `arch:check` только
  внутри `modules/`. Варианты: (a) `modules/media/` + правило dependency-cruiser `media-leaf` (media не импортирует
  `modules/*`) — **рекомендую**; (b) `src/media/` как `upload-slots.ts` — без проверки границ и вне `paths:` правил
  безопасности; (c) `src/media/` + правка `paths:` и своё правило cruiser — то же, что (a), но с правкой правил.
- **R2. Слоты приёма — общие или свои.** P9 «4 на процесс, 1 на пользователя» при отдельном `UploadSlots` у райдов
  удваивает буфер тел (8 × 10 МиБ) против бюджета ADR-0019 (4 × 10 МиБ под 512 МБ). Варианты: (a) общий
  `ImageUploadSlots` для аватара и фото райда — **рекомендую** (поведение аватара для одиночного пользователя то же;
  параллельно аватар и фото одного пользователя — 429 `retryAfterSec: 5`); (b) свои 2 + 2; (c) свои 4 + 4 с пересчётом
  ADR-0019.
- **R3. AC1 «404/403».** Правило rides — чужой райд для мутации только 404 (`ownRide`, `pokatim-security.md`); 403 не
  бывает. Скрытый своему организатору — 409 `RIDE_INVALID_STATE` (как правка). Исправить формулировку AC1 на «404».
- **R4. Экстремальные пропорции.** «Короткая сторона < 400 → 422» по входу пропускает панораму 12000×600 → после
  вписывания в 1600 — полоса 1600×80. Варианты: (a) проверять короткую сторону **результата** ≥ 400 (для больших кадров ⇔
  пропорция ≤ 4:1) — **рекомендую**; (b) проверять вход + отдельный предел пропорции; (c) только вход (полосы
  допускаются, `cover` на герое их растянет).
- **R5. PNG 2 МБ и фото.** Фотографический PNG 1080×1920 truecolor — обычно 2,5–4 МБ > `STORY_CARD_POLICY.maxPngBytes`;
  URL карточки — `<token>.png` (контракт `StoryCardStatus`). Варианты: (a) композиция в sharp и `png({ palette: true,
  quality: 80, dither: 1 })` (≈ 0,8–1,5 МБ) с проверкой на шумной фикстуре в тесте, лимит 2 МБ прежний —
  **рекомендую**; (b) отдельный предел `maxPhotoPngBytes` 4 МБ (Redis × 24 ч растёт); (c) JPEG для карточки с фото —
  смена контракта/имени файла и клиентов, отклонить.
- **R6. `immutable` на год и снятие.** P6/AC2 «как аватар», но фото райда снимают модерация, скрытие райда и удаление
  аккаунта, а id в кэше браузера живёт год. Варианты: (a) `public, max-age=86400, immutable` — снятое уходит из кэшей за
  сутки, id всё так же меняется при замене — **рекомендую**; (b) год, как аватар (принятый риск ADR-0019); (c)
  `no-cache` + ETag — лишние запросы ленты.
- **R7. «Измеренное затемнение».** Прототипов `key-rides.html`/`key-home.html` в репозитории нет — значения скрима не
  проверить. Решение: токен в `@pokatim/design-tokens` (градиент на `overlay.scrim`: зоны текста и середина), текст — роль
  `onPhoto`; unit-тест токена: контраст `onPhoto` к скриму над **белым** фото в зонах текста ≥ 4.5:1 (WCAG). Один токен
  для 4a (PR A) и героя (PR B). Значения — сверить с прототипом в PR B (вопрос человеку, если разойдутся).
- **R8. Номера.** `0047_ride_photos` и ADR-0028 свободны на `origin/develop` (c8a4f4e3), но идут параллельные сессии —
  сверить перед PR; при коллизии — следующий номер (миграция ссылается на имя, не на номер).
- **R9. Коды ошибок.** Варианты: (a) переиспользовать `AVATAR_*` — неверная семантика в контракте, (b) `RIDE_PHOTO_*`
  — по тройке кодов на каждый будущий вид фото, (c) **общие `IMAGE_FORMAT_UNSUPPORTED` (415) / `IMAGE_TOO_LARGE` (413) /
  `IMAGE_INVALID` (422, `details.reason: 'too_small' | 'unreadable'`, `tolerantEnum`)** для всех новых потребителей
  `media`; аватар остаётся на `AVATAR_*` навсегда (AC6, старые клиенты) — **рекомендую (c)**. Новые коды —
  только у нового эндпоинта: старые версии приложения их не получают.
- **R10. Сброс модератором — побочные эффекты.** P7 не говорит про жалобы и уведомление. Принято: жалобы не закрываются
  (решение по ним — «Скрыть»/«Отклонить», как раньше), `version` не меняется, уведомления организатору нет (follow-up в
  `notifications`, как `profile_avatar_reset`), тело несёт `photoId` из карточки (сброс фото, которого модератор не
  видел, — 409 `CONFLICT`, как `lastReportAt`).
- **R11. Панель и фото скрытого райда.** Отдача — 404 при скрытом райде (P6), значит в карточке скрытого райда панель
  фото не покажет. Варианты: (a) в PR C — плашка «Фото скрыто вместе с райдом», «Удалить фото» доступно (id в
  `ModerationRideDetail.photo`) — **рекомендую** (основной кейс — очередь `open`, райд виден); (b) `GET
  /v1/admin/rides/:id/photo` под `PanelGuard` + blob в панели (CSP `img-src blob:`); (c) отдавать байты скрытого по
  панельной сессии через публичный URL — нельзя.
- **R12. Хранение.** Фото прошедших и отменённых райдов живут до удаления организатором/стирания аккаунта (≤ 1 на райд,
  ≈ 0,2–0,5 МБ). `[ASSUMPTION]`, очистка по сроку — follow-up при росте.
- **R13. AC6 «без правок ожиданий».** Тесты профиля ссылаются на `AvatarProcessing` и `PROFILE_POLICY.avatarProcessing`;
  после переноса меняются только импорты/имена, числа, коды и заголовки в ожиданиях — нет.
- **Согласованность с ADR.** ADR-0019: бюджет памяти сохраняется (одна обработка на процесс на все фото, общие слоты),
  cover-стадия легче аватарной (1600 < 2048). ADR-0018: 4a без фото → с фото (дополнение), правило `renderVersion`
  соблюдено. ADR-0015: шаг `rides` расширяется, порядок шагов не меняется. ADR-0013: транзакция «райд + ride_photos» не
  трогает инвариант участия (одна атомарная операция над документом), `version` — по-прежнему только правки и
  «Скрыть»/«Вернуть». ADR-0011: «файлы наружу не выдаются» — фото райда второе исключение после аватара, оформить в
  ADR-0028 и `pokatim-security.md`.

## 8.2 Deviations from spec

Решения оркестратора: R1–R13 приняты как записаны в 8.1 (AC1 читать как «не организатор — 404», R3).
Отклонения реализации PR A (coder, 2026-10-31):

- **D1. `OpaqueToken` не перенесён в `common.ts`.** Такая схема уже экспортируется из `auth/verification.schema.ts`
  (токены ссылок, регистрации, сессии); второй экспорт с тем же именем ломает `export *` в `index.ts`. `AvatarId`,
  `RiderPublicId` и `RidePhotoId` — `= OpaqueToken` оттуда (форма прежняя).
- **D2. `avatar-image.test.ts` не тронут** (AC6): тест `detectImageFormat` там остался (реэкспорт), в
  `media/image-format.test.ts` — копия кейсов для ядра. `avatar-processing-gate.test.ts` перенесён как
  `media/image-processing.test.ts` (только имя класса).
- **D3. Правки чужих тестов без ослабления:** `social.schema.test.ts` — «`SOCIAL_ACTION_BLOCKED` последний» →
  «есть в списке» (порядок всего списка держит `common.test.ts`); `og-card.inputs.test.ts` — в цикле «каждое поле
  фактов меняет ключ» пропущено `ride.photoId` (OG фото не рисует, P4) + явный кейс «`photoId` ключ OG не меняет»;
  `achievement-card.render.test.ts` — эталон хэша и `renderVersion` 4 (подъём версии по §5); `story-card.inputs.test.ts`
  — тип мока версии; `rides-route.int.test.ts` — ключ `photo` в явном списке полей публичной карточки;
  `migrations.int.test.ts` — «последняя» перенесено с `0045_social` на `0047_ride_photos`.
- **D4. Минимальные правки PR B/C для сборки:** фикстуры тестов приложения (8 файлов) и панели
  (`RideModerationScreen.test.tsx`) — `photo: null` (выход схем `RideSummary`/`ModerationRideDetail` требует поле);
  `admin.audit.action.ride.photo_reset` в `packages/i18n`.
- **D5. Цвета 4a с фото:** метка «Кофе-райд» (акцент темы) на фото тоже `onPhoto` — контраст акцента к скриму не
  проверен тестом токена; точка старта линии — акцент (UI, не текст). Сделано через цвета рендера
  (`rideInviteRenderInput`), дерево `nightCard` не менялось (снимки дерева без фото — прежние).
- **D7 (ревью PR A, LOW).** Повтор кодирования 4a при превышении `maxPngBytes` — палитрой **16** цветов, не 128:
  libvips пишет палитру глубиной 1/2/4/8 бит по числу цветов, 128 и 256 цветов дают тот же 8-битный PNG того же
  размера (замер sharp 0.35.5: шум 1080×1920 — 2 067 086 байт и при 256, и при 128, и при 64 цветах); 16 цветов — 4 бита.
  `encodePhotoCard` + `PHOTO_CARD_PALETTES = [256, 16]`, тест `ride-invite.png.test.ts`.
- **D6. Проверки «свой будущий райд»** — `RidesService.ownRide` / `assertUpcoming` / `viewOf` стали публичными
  методами (вариант «вызывать через `RidesService`» §5.1), копий нет.

Отклонения и уточнения PR B (coder, 2026-10-31):

- **D8. Загрузка — `api.uploadRidePhoto` (fetch с Blob), не native upload task.** §11 упоминает
  `ridePhotoUploadRequest` «как аватар», но аватар в приложении грузится `api.uploadAvatar` с Blob на всех платформах
  (без XHR и прогресса, `pokatim-app.md`); фото райда — тот же путь. `ridePhotoUploadRequest` в приложении не нужен.
- **D9. Общий выбор фото — `features/media/pick-image(.web).ts`.** `load-image-picker.ts` и `image-picker-support.ts`
  перенесены из `features/profile` (пути в `jest.setup.ts` и тестах профиля — только импорты), `pick-avatar.web.ts`
  удалён — развилка платформ теперь в `pickImage`, `pick-avatar.ts` — обёртка с ошибками аватара (тесты
  `pick-avatar(.web).test.ts` без правок ожиданий). Для фото без обрезки на iOS — `preferredAssetRepresentationMode:
  compatible` (без него `expo-image-picker` отдаёт HEIC как есть → 415). Ревью pass 1: формат на native по
  `asset.mimeType` **не проверяется** — это MIME исходника, а при `quality < 1` Android уже перекодировал HEIC в JPEG
  (ложный отказ); сигнатуру проверяет сервер, текст 415 тот же. Web — фильтр и пре-чек MIME `File` как раньше.
- **D10. Затемнение героя — полосы `View` (48) по `photoScrimAlpha`,** не SVG-градиент: `react-native-svg` на native
  грузится лениво с фолбэком (`useSvgLib`) — на время загрузки текст стоял бы на фото без скрима; полосы одинаковы на
  всех платформах. Ревью pass 1: профиль 4a (`photoScrim`, провал на ~0,2 высоты) герою не подходит — кикер попадал в
  провал; герой — отдельный токен **`photoScrimHero`** (монотонно 0,30 → 0,58 на 0,2 → 0,82 внизу, зона текста —
  нижние 80 %, тест контраста `onPhoto` ≥ 4.5:1 поверх белого фото во всех темах). `photoScrimAlpha(at, profile)` —
  профиль вторым аргументом (по умолчанию 4a, API не менялся). Значения обоих профилей с прототипом не сверены —
  прототипов в репозитории нет (R7), остаются `[ASSUMPTION]`.
- **D11. «Удалить фото» — без подтверждения** (в отличие от аватара): спецификация его не требует, вернуть фото —
  загрузить снова; кнопка только при фото и занята на время запроса (LOW findings PR A). Шаблон карточки после загрузки
  не переключается на «Ночь» автоматически — подсказка блока говорит, где фото.
- **D12 (ревью pass 1). Удаление своего фото после старта и отмены — в карточке райда.** Экран приглашения открывается
  только у будущего райда, поэтому «Удалить фото» у прошедшего и отменённого — `RidePhotoDelete` в `rides/[id]`
  (организатор, без `canManage`, при `ride.photo`; тот же `useDeleteRidePhoto`, кнопка занята на время запроса).
  **Скрытый райд:** view отдаёт `photo: null` (P6, согласовано с 404 отдачи) — из приложения не удалить; принято:
  фото снимает модератор («Удалить фото» в панели, PR C) или стирание аккаунта.
- **D13 (ревью pass 1). Блок «Своё фото» — `AsyncContent` по `me`:** скелетон на первой загрузке, ошибка без данных
  — «Нет соединения» / «Не удалось загрузить» с повтором, ошибка обновления — блок остаётся с баннером; 404 `me`
  (скрытый, неизвестный) — без блока (карточка уже «Приглашение недоступно»); ответ без права — без блока. Не
  организатор на первой загрузке видит скелетон блока до ответа `me` — принято. Лишний запрос `me` на экране
  приглашения (публичная карточка грузится отдельно) — оставлен.
- **D14 (ревью pass 1). Web: кнопка не занята на время диалога файла** (`PICK_IMAGE_BUSY_WHILE_OPEN = false`): без
  события `cancel` у `<input type="file">` промис выбора не завершится; занята — только на время запроса (как у
  аватара). Native — занята, пока открыта галерея (модальная, отмену сообщает).

## 8.3 Security checklist

Зона `pokatim-security.md` (`modules/rides/**`, `modules/media/**`, `raw-body.ts`, `upload-slots.ts`) — чек-лист
обязателен.

- **AuthN/AuthZ.** `rides/:id/photo*` — `AuthGuard` на классе, пользователь — только `@CurrentUser()`, `organizerUserId`
  в фильтре каждой записи (не только в предварительном чтении); чужой/неизвестный — 404. Панель — `PanelGuard` +
  `@RequirePermission('rides.moderate')` на классе (сторож `admin-routes.test.ts`), актор — `@CurrentPanelUser()`.
  `GET /v1/ride-photos/:id` — `PublicReadGuard` (IP-лимит), доступ по `randomToken` (32 байта) + проверка «райд не скрыт и
  фото текущее» на каждом запросе.
- **Входные данные.** Тело — только `application/octet-stream` ≤ 10 МиБ (`readLimited`, 413/415/408 +
  `Connection: close`), формат — по сигнатуре и совпадению с декодером, JPEG/WebP ≤ 100 Мп, PNG ≤ 25 Мп, `failOn:
  'error'`, `animated: false`, таймаут 10 с, короткая сторона результата ≥ 400. Id — `Uuid`/`RidePhotoId` pipe; тело
  сброса — `strictObject { photoId: RidePhotoId, reason: ActionReason }`; в фильтры — только примитивы после zod.
- **Данные наружу.** Хранится и отдаётся только перекодированный JPEG без метаданных (EXIF/GPS/XMP/ICC не пишутся,
  исходник не хранится); `nosniff`, `CSP: default-src 'none'; sandbox`, заголовки файла — после чтения (404 — JSON без
  `immutable`). Во view — только `photo: { id }`; без `organizerUserId`, размеров файла, `createdAt`. В
  `ModerationRideDetail` — `photo: { id }`. На карточке 4a — фото организатора (публичное по смыслу: он загрузил его для
  приглашения) + прежние публичные поля; без имени, участников.
- **Злоупотребления.** `ride-photo:<uid>` 20/ч (после слота, отказ слота квоту не списывает), общий слот приёма 4/1 и
  гейт 1 на процесс с аватаром, удаление — `rides-manage` 30/ч, тело: тишина 10 с, всё 60 с (как аватар). Загрузка
  только в свой будущий опубликованный райд (квота 5 будущих райдов ограничивает объём). Рендер — прежние лимиты
  `story-card-*`.
- **Секреты и логи.** Логи — `ride`, `uid`, размер, формат, исход (`rides.photo_replaced|photo_rejected|photo_removed`);
  без названий, байтов, id фото и сообщений libvips. Worker — id райда, шаблон, итог, байты PNG, мс.
- **Аудит.** `ride.photo_reset` (append-only, в транзакции действия, subject `ride` + label-название, `reason`, `details:
  null` — без id фото). Загрузка/удаление организатором не журналируются (как смена аватара).
- **Скрытие/стирание.** Скрытый райд — 404 на отдаче всем, `photo: null` во view, 404 у приглашения (уже), worker
  перепроверяет через `invitePhoto`. Стирание аккаунта — все `ride_photos` организатора + `photoId: null`.
- **Принятый риск.** Кэш браузеров держит снятое фото до 24 ч (R6).
- **Принятый риск (ревью PR A).** Уже выданный PNG приглашения `night` со снятым, скрытым или стёртым фото живёт в
  Redis до 24 ч по капабилити-ссылке; follow-up — инвалидация карточек райда при сбросе фото.

## 9. Acceptance Criteria

- AC1. Организатор будущего опубликованного райда загружает JPEG/PNG/WebP ≤ 10 МиБ → `200` с view райда, `photo.id`;
  повтор заменяет фото, прежний URL — 404. Не организатор — 404/403 по правилам райда; прошедший/отменённый/скрытый —
  409 `RIDE_INVALID_STATE`; не изображение — 415; битое/мелкое — 422; лимит — 429.
- AC2. `GET /v1/ride-photos/:id` — `image/jpeg`, `immutable`, `nosniff`, `sandbox`; EXIF/GPS в байтах нет; скрытый райд — 404.
- AC3. Удаление своим организатором идемпотентно; модератор «Удалить фото» с причиной — журнал, URL 404.
- AC4. Удаление аккаунта стирает `ride_photos` организатора и `photoId` на его райдах.
- AC5. Приглашение `night` с фото — фото под затемнением, без фото — как сейчас; смена фото даёт новую картинку.
- AC6. Аватар работает как до PR (тесты профиля зелёные без правок ожиданий).
- AC7. Приложение: организатор добавляет/заменяет/удаляет фото на экране карточки; герой ленты и Главной показывает фото.
- AC8. Панель: фото в карточке райда, «Удалить фото».

## 10. Documentation Impact

ADR-0028 (+ строка в `docs/adr/README.md`), `docs/product/rides.md` (раздел фото, строка «Скрыто»), ADR-0018
дополнение (4a с фото), ADR-0015 (шаг `rides` стирает фото), `docs/product/admin-panel.md` (действие), `.claude/rules`
при необходимости.
Уточнение architect: полный перечень — §11 «Documentation impact (PR A)» (+ ADR-0011, ADR-0019, `pokatim-db.md`,
`.dependency-cruiser.cjs`).

## 11. Implementation Context

### PR A — API + contracts + sharing + доки

**ENTRY POINTS.** `PUT /v1/rides/:id/photo`, `POST /v1/rides/:id/photo/delete`, `GET /v1/ride-photos/:id`,
`POST /v1/admin/rides/:id/photo-reset`, задача `ride-invite.render` (worker), шаг `rides` стирания аккаунта.

**Порядок работы (TDD).** 1) contracts (+ api-client) → 2) `media` вынос с зелёными тестами профиля (отдельный коммит,
поведение аватара не меняется) → 3) миграция → 4) репозиторий/сервис/контроллеры фото → 5) view → 6) модерация →
7) стирание → 8) рендер 4a → 9) доки, `pnpm check`.

**TYPES & SCHEMAS (contracts).**
- `common.ts`: `OpaqueToken` (перенос из `rider-avatar.schema.ts`, `AvatarId = OpaqueToken` — без изменения формы);
  коды `IMAGE_FORMAT_UNSUPPORTED`, `IMAGE_TOO_LARGE`, `IMAGE_INVALID` (в конец списка, с комментарием «media:
  фото райда и следующие виды»); тексты — `apps/api/src/error-messages.ts`.
- `rides/ride.schema.ts`: `RIDE_PHOTO_MAX_BYTES = 10 MiB`, `RIDE_PHOTO_MAX_EDGE_PX = 1600`, `RIDE_PHOTO_MIN_SHORT_PX =
  400`; `RidePhotoId = OpaqueToken`; `RidePhotoRef = z.object({ id: RidePhotoId })`; `RideSummary.photo:
  RidePhotoRef.nullable().default(null)` (старый сервер — `null`; старый клиент поле отбрасывает — `z.object` не
  strict); `ImageInvalidDetails = z.object({ reason: tolerantEnum(['too_small', 'unreadable']) })`.
- `rides/ride-moderation.schema.ts`: `ModerationRideDetail.photo: RidePhotoRef.nullable().default(null)`;
  `ResetRidePhotoRequest = z.strictObject({ photoId: RidePhotoId, reason: ActionReason })`.
- `admin/audit.schema.ts`: `'ride.photo_reset'` — **в конец** `AUDIT_ACTIONS` (R6 файла); строка
  `admin.audit.action.ride.photo_reset` в `packages/i18n` (иначе панель не соберётся).
- `media.policy.ts`: `MEDIA_POLICY = { processing: { concurrency: 1, waitMs: 5_000 }, uploadSlots: { maxTotal: 4,
  maxPerUser: 1 }, timeoutSec: 10, jpegQuality: 82 }`; `PROFILE_POLICY.avatarProcessing/avatarSlots` удаляются (или
  ссылаются на тот же объект — без копии значений).
- `RIDES_POLICY.photoUploadLimit = { limit: 20, windowSec: 3600 }` (ключ `ride-photo:<uid>`), `photoBodyTimeouts = {
  idleMs: 10_000, totalMs: 60_000 }`.

**Data & migrations.** `0047_ride_photos` (expand-only, идемпотентна, без транзакции): `ensureCollection(ride_photos)`,
индексы `ride_photos_ride_unique` `{ rideId: 1 }` unique (одно фото на райд; транзакция «удалить → вставить») и
`ride_photos_organizer_idx` `{ organizerUserId: 1 }` (стирание). `rides.photoId` — без бэкфилла (чтение `?? null`),
индекс по нему не нужен (поиск только по `_id`). Документ: `{ _id: randomToken, rideId, organizerUserId, bytes: Binary,
contentType: 'image/jpeg', width, height, bytesLength, createdAt }` (≈ 0,2–0,5 МБ; читать `bytes` только в отдаче и
`invitePhoto`, остальные чтения — проекцией без `bytes`). Тест миграции — «последняя; индексы; повторный up — без
изменений» в `migrations.int.test.ts`. Не деструктивна.

**Jobs & events.** Новых очередей и событий outbox нет. `ride-invite.render` — прежний `jobId: ride-invite-<hash>`
(идемпотентность по хэшу, в хэше `photoId` для `night`), 2 попытки, финальный провал — `failed` в статусе карточки
(как сейчас). Фото заменили/скрыли между постановкой и рендером — `invitePhoto` → `null` → устаревший вход, без
ретрая. og.sync — не меняется (OG без фото).

**Серверный авторитет.** Клиент шлёт байты; ориентацию, размер, кадрирование, затемнение и «текущее фото» решает сервер;
id генерирует сервер; `version` не принимается.

**FILES TO MODIFY / READ** — §6.

**TESTS (матрица PR A).** Int-тесты — реальные mongod `127.0.0.1:27117` (rs0) и redis `6479` через `test/harness.ts`,
как остальные `*.int.test.ts`; фикстуры — `test/avatars.ts`.
| Уровень | Что |
|---|---|
| unit `media/image-format.test.ts` | сигнатуры JPEG/PNG/WebP/GIF/мусор (перенос) |
| unit `media/image-pipeline.test.ts` | cover: 4000×3000 → 1600×1200; 1200×900 без увеличения; EXIF-ориентация 6 → портрет; 300×300 → `too_small`; 12000×600 → `too_small` (R4); PNG > 25 Мп → `invalid` без декода; битый JPEG → `invalid`; GIF → `unsupported`; в выходе нет EXIF/GPS (`hasGpsIfd`) |
| unit `media/image-processing.test.ts` | перенос тестов гейта без изменения ожиданий |
| unit `avatar-image.test.ts` | без изменений ожиданий (AC6) |
| unit `contracts` | `RideSummary` без `photo` → `null`; `ResetRidePhotoRequest` strict; `IMAGE_*` в `ErrorCode`; `ride.photo_reset` последний |
| unit `rides-feed`/policy | `photo` во view: есть/нет/скрытый → `null` |
| unit `ride-invite.render.test.ts` / `ride-invite.png` | хэш: смена `photoId` меняет `night`, не меняет `line`; рендер с фото — PNG 1080×1920 ≤ 2 МБ на шумной фикстуре (R5), без фото — как раньше |
| unit design-tokens | контраст `onPhoto` над скримом поверх белого ≥ 4.5:1 в зонах текста (R7) |
| int `ride-photos.int.test.ts` | AC1: 200 + `photo.id`, замена → прежний URL 404, `version` прежний; не организатор и неизвестный — 404; прошедший/отменённый/скрытый — 409 до тела (`Connection: close`); не изображение — 415 `IMAGE_FORMAT_UNSUPPORTED`; > 10 МиБ — 413; мелкое — 422 `IMAGE_INVALID { reason: too_small }`; 21-я загрузка — 429; второй параллельный приём того же пользователя (в т. ч. аватар + фото) — 429 (R2); гейт занят аватаром → фото 429 после `waitMs` (один экземпляр `ImageProcessing`: `app.get(ImageProcessing, { strict: false })` из обоих модулей — тот же объект) |
| int (отдача) | AC2: `image/jpeg`, `Cache-Control` из R6, `nosniff`, `sandbox`, нет EXIF/GPS; скрытый райд — 404 (и организатору), вернули — снова 200; кривой id — 400; неизвестный — 404 JSON без `immutable` |
| int (удаление) | AC3: своё — 200 `photo: null`, повтор — 200; скрытый/прошедший — тоже можно; чужое — 404 |
| int гонка | замена параллельно со сбросом модератора — в итоге ≤ 1 документ `ride_photos` на райд, `photoId` указывает на существующий |
| int `rides-moderation` | AC3: сброс с причиной → 200, URL 404, журнал `ride.photo_reset` (subject `ride`, `details: null`), жалобы и `version` не тронуты; чужой `photoId` — 409 без журнала; фото нет — 200 без журнала; без `rides.moderate` — 403; `ModerationRideDetail.photo` |
| int `account-erasure` | AC4: фото организатора (в т. ч. скрытого/прошедшего райда) удалены, `photoId: null`, чужие фото целы; повтор — no-op |
| int `rides-feed`/`rides` | `photo` в ленте, `me`, публичной карточке; скрытый — `null` |
| int `ride-invite.int.test.ts` | AC5: `night` с фото — новый хэш/токен после замены фото; `line` — тот же; фото снято между постановкой и рендером — без картинки, без ретрая |
| int профиль | AC6: `profile-avatar*.int.test.ts` зелёные (только импорты/имена) |
| e2e | не нужен в PR A (UI нет); e2e/скриншоты — PR B/C |

**OUT OF SCOPE (PR A).** UI приложения и панели; OG и шапка детали с фото; уведомление организатору о сбросе; запрет
повторной загрузки; админская отдача байтов скрытого райда (R11 b); S3/CDN; вторая (уменьшенная) копия для ленты.

**Documentation impact (PR A).** ADR-0028 «Конвейер изображений и фото райда» (решение C, `media` как модуль-лист,
один гейт и общие слоты, коды `IMAGE_*`, отдача и кэш, ride_photos, рендер 4a, почему не A/B) + строка в
`docs/adr/README.md`; ADR-0018 (4a с фото, `renderVersion` 4, PNG palette); ADR-0019 (гейт и слоты переехали в
`media`, бюджет общий); ADR-0015 (шаг `rides` стирает фото); ADR-0011 (второе исключение); `docs/product/rides.md`
(раздел «Фото организатора», строка «Скрыто» → «сделано (API — PR A)»); `docs/product/admin-panel.md` («Удалить фото»
— API); `pokatim-security.md`, `pokatim-db.md`; `pr.md` — миграция `0047_ride_photos`, без env.

### PR B — приложение (заметки)

- `features/rides`: экран `ride-invite-screen` — у организатора (`viewer.role === 'organizer'` и `canManage`) «Добавить
  своё фото» / «Заменить фото» / «Удалить фото»; выбор — `expo-image-picker` без обрезки (`allowsEditing: false`), отправка
  — `api.uploadRidePhoto` / `ridePhotoUploadRequest` (native upload task, как аватар); ответ `RideView` → кэш запросов
  `me`/ленты обновить, статус карточки `night` перезапросить (новый хэш). Ошибки `IMAGE_*` (+ `reason: too_small`),
  413/415/429/409 — тексты в `packages/i18n`. Кнопки — состояние disabled/индикатор внутри (§4.12).
- Герой ленты и Главной: `photo` → `expo-image` (`contentFit: 'cover'`, центр) + скрим из того же токена, текст —
  `onPhoto`; без фото — прежний типографский герой. Все платформы (iOS/Android/web); web — CSP `img-src` уже пускает
  API-origin (аватары) — проверить ADR-0025 тестом.
- Превью 4a — прежний поток `invite-card` (картинка с фото рендерится сервером).
- Тесты: компоненты героя (с фото/без), экран карточки (организатор/не организатор, ошибки), web-смоук.

### PR C — панель (заметки)

- `features/rides` карточка модерации: `ModerationRideDetail.photo` → `<img src={api.ridePhotoUrl(id)}>` (API-origin уже
  в CSP панели — `csp.test.ts`); у скрытого райда — плашка «Фото скрыто вместе с райдом» (R11 a). Кнопка «Удалить фото»
  → диалог причины (`ActionReason`, предупреждение «свободный текст»), `admin.resetRidePhoto(id, { photoId, reason })`;
  409 — «Фото уже изменилось, обновите карточку». Журнал — строка `ride.photo_reset`.
- `docs/product/admin-panel.md` — действие в UI; e2e-смоук панели — по возможности.

## 12. Outcome (заполняет coder)

### PR A — API, контракты, `media`, 4a с фото (coder, 2026-10-31)

**Сделано** (ветка `feature/organizer-photo`, коммиты по шагам §11): контракты и api-client (`RidePhotoRef`,
`RIDE_PHOTO_*`, `ImageInvalidDetails`, `IMAGE_*`, `ResetRidePhotoRequest`, `ride.photo_reset`) → `modules/media`
(вынос конвейера, гейта, слотов и отдачи JPEG из профиля; аватар без изменения поведения) → миграция
`0047_ride_photos` → фото райда в `rides` (загрузка, удаление, отдача, view, сброс модератором, стирание, порт
`invitePhoto`) → токен `photoScrim` и 4a с фото в `sharing` (`renderVersion` 4) → доки (ADR-0028, дополнения
ADR-0011/0015/0018/0019, `rides.md`, `admin-panel.md`, `pokatim-security/db/backend.md`). Номера `0046` и ADR-0028
свободны на `origin/develop` (`ceb9fa70`, проверено `git ls-tree` перед коммитом доков). Отклонения — 8.2 (D1–D6).

**AC.** AC1–AC5 — int `ride-photos.int.test.ts` (20 кейсов: приём, 404/409 до тела с `Connection: close`, 415/413/422
`too_small`/`unreadable`, 429 квоты, общий слот с аватаром, общий гейт, отдача с заголовками и без EXIF/GPS, скрытый —
404 и `photo: null`, удаление, сброс модератором с журналом/409/без журнала, гонка замены со сбросом, стирание) и
`ride-invite.int.test.ts` (4a: новый токен после замены фото, `line` прежний, снято между постановкой и рендером —
`skipped`, порт `invitePhoto`); AC6 — `profile-avatar*.int.test.ts` зелёные (только импорты `ImageProcessing`,
`MEDIA_POLICY.processing`). AC7/AC8 — PR B/C.

**Проверки.**
- Полный `pnpm check` (`MONGO_URL_TEST=…/ridephoto_test?replicaSet=rs0&directConnection=true`,
  `REDIS_URL_TEST=redis://127.0.0.1:6479/11`, `TURBO_CONCURRENCY=4`) на **HEAD `fadbcb76`** — `EXIT=0`: prettier — «All
  matched files use Prettier code style!»; depcruise — «no dependency violations found (2370 modules, 9439
  dependencies cruised)»; typecheck — 9/9; тесты — 15/15 задач: api 239 файлов / 2643 теста, app 267 наборов / 2559,
  admin 49 / 511, contracts 53 / 493, design-tokens 609, api-client 175, tracks 374, route-view 51, i18n 15.
- После него — только таймаут тестов `ride-invite.png.test.ts` 30 → 60 с (шумная фикстура под нагрузкой полного прогона
  шла 14,4 с) и доки задачи; таргетно: `vitest run --project unit src/modules/sharing/ride-invite.png.test.ts` — 3 passed,
  prettier — ok.
- Размер PNG 4a с шумным фото 1600×1200: 1 729 902 байт (предел 2 000 000), рендер ≈ 1,7 с без нагрузки.

**Риски / follow-up.** Запас PNG на чистом шуме ~13 % (реальные фото сжимаются лучше); скрим — `[ASSUMPTION]` до сверки
с прототипом в PR B; кэш браузеров держит снятое фото до 24 ч; `renderVersion` 4 перерисует все карточки сторис по
запросу; отрицательное доказательство гонки замены/сброса не снималось (механизм — запись райда первой, как 05b).

### Правки по ревью PR A (findings-codex.md, findings.md)

- **MEDIUM — гонка «замена ↔ сброс модератором».** Ворота перенесены **после** `setPhoto` (запись райда в открытой
  транзакции замены): сброс по прежнему `photoId` упирается в незакоммиченную запись (`untilBlocked` +
  `retried(spy resetPhoto)` — повтор транзакции), после коммита замены повтор сброса видит новое фото → `409 CONFLICT`
  без журнала; в `ride_photos` ровно один документ — новое фото, `rides.photoId` указывает на него, прежний URL — 404.
  **Отрицательное доказательство:** временно убрал `photoId` из фильтра `RidesRepository.resetPhoto` → тест красный по
  результату: `AssertionError: expected 200 to be 409` (сброс снял новое фото, которого модератор не видел); код
  возвращён (`git diff` файла пуст).
- **LOW — предел PNG 4a:** одна попытка палитрой 16 цветов (D7).
- **LOW — риск PNG `night` в Redis до 24 ч** — 8.3, ADR-0028, `pokatim-security.md`; follow-up — инвалидация карточек
  райда при сбросе фото.
- **LOW — правила:** `pokatim-contracts.md` (строка ride-photo), `pokatim-backend.md` (`renderVersion` 4).
- **LOW (claude) — квота `rides-manage` тратится на no-op удаление фото** — без изменений (как удаление аватара);
  учесть в PR B: кнопка «Удалить фото» видна только при `ride.photo`, блокируется на время запроса.

### PR B — приложение (coder, 2026-10-31)

**Сделано** (ветка `feature/organizer-photo-app` поверх PR A): `f9bf17ad` — блок «Своё фото» на экране
карточки-приглашения (`ride-photo-section.tsx`: только `viewer.role === 'organizer' && canManage`; «Добавить своё фото»
/ «Заменить фото», «Удалить фото» только при фото, кнопки заняты на время выбора и запроса), хуки
`useUploadRidePhoto`/`useDeleteRidePhoto` (`applyRideView`: кеш `me` + инвалидация `['rides']` → лента, Главная,
деталь, статус карточек приглашения), тексты `ride-photo-errors.ts` и `rideInvite.photo.*`, общий выбор фото
`features/media/pick-image(.web).ts` (аватар — обёртка); `c230b3e8` — `SectionHero photo` + `PhotoScrim` (токен
`photoScrim`, текст `onPhoto`, фото декоративное, ошибка картинки — типографский герой), `RideHero` →
`api.ridePhotoUrl`; `87474c49` — `rides.md`, `pokatim-app.md`; `bb893596` — 8.2 D8–D11, `pr-b.md`.

**AC7.** `ride-invite.test.tsx` (не организатор и организатор без права — блока нет; добавление: `pickImage({ maxBytes:
RIDE_PHOTO_MAX_BYTES, square: false })` → `uploadRidePhoto(token, id, blob)` → «Заменить фото», «Удалить фото», статус
карточки перезапрошен; отмена выбора — без запроса; 422 `too_small` и 409 — текст баннером; удаление — кнопки заняты,
затем «Добавить своё фото»), `ride-photo-errors.test.ts` (415/413/422/429/409, проверка до отправки, старый
dev-клиент, удаление, сеть), `pick-image(.web).test.ts`, `photo-scrim.test.tsx`, `section-hero(.web).test.tsx` (фото
`cover` с пустым alt, скрим `aria-hidden`, onPhoto, ошибка картинки), `home.test.tsx` и `rides.test.tsx` (герой с
фото). Профиль — тесты аватара без правок ожиданий (только пути моков). CSP `img-src` с origin API — существующий
`web-server.test.ts` (название кейса дополнено).

**Проверки.**
- Полный `pnpm check` (`MONGO_URL_TEST=…/ridephotoapp_test?replicaSet=rs0&directConnection=true`,
  `REDIS_URL_TEST=redis://127.0.0.1:6479/12`, `TURBO_CONCURRENCY=4`) на **HEAD `bb893596`** — `EXIT=0`: prettier — «All
  matched files use Prettier code style!»; depcruise — «no dependency violations found (2387 modules, 9512
  dependencies cruised)»; typecheck — 9/9; тесты — 15/15 задач: app 272 набора / 2598 тестов, api 240 / 2676, admin
  49 / 511, contracts 494, design-tokens 609, api-client 175, tracks 374, route-view 51, i18n 15.
- Первый прогон (HEAD `87474c49`, load average ~40 от параллельных сессий) — `EXIT=1` только по таймаутам под
  нагрузкой в нетронутых файлах (app: `route-detail`, `race-disputes`, `race-participation`, `ride-detail`,
  `ticket-screen`, `devices-step`; api: `parse-thread`, `ride-invite.png`); отдельно — 6/6 наборов (223 теста) и 2/2
  файла (13 тестов) зелёные; второй полный прогон — зелёный (выше).
- После `bb893596` — только этот раздел (prettier — ok).
- Визуальная проверка web-превью героя и ручная проверка на симуляторе/устройстве — **NOT VERIFIED**.

**Риски / follow-up.** Значения скрима — `[ASSUMPTION]` (прототипов нет, D10); автопереключение шаблона на «Ночь» после
загрузки не делалось (D11); ручной смоук загрузки HEIC с iPhone (`compatible` → JPEG) — на dev-сборке.
