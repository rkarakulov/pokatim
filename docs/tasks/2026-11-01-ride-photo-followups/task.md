# task.md — фото организатора: follow-up (ride-photo-followups)

Уровень: task3. Ветка: `ride-photo-followups` от `origin/develop` (8a98452c). PR — в `develop`.
Основа: `docs/tasks/2026-10-31-ride-photo/task.md` (8.1 R10, R11; 8.3; §12 «Итог задачи»), ADR-0028.
Architecture Review (architect, 2026-11-01) — **Status: CONCERNS** (блокеров нет; решения 8.1 R1–R12 — рекомендации,
принимаются как `[ASSUMPTION]`, если человек не возразит).

> Перед кодом: `origin/develop` ушёл вперёд (aaf9da74, #184 social P5) и трогает `rides/index.ts`,
> `rides.repository.ts`, `rides-for-social*`, `outbox-routes.ts`, `queues.ts` — сначала `git merge origin/develop` (без
> rebase, AGENTS §7). Файлы параллельных сессий (social, route-rides, гонки R2–R4) не трогать, кроме точечных строк,
> перечисленных в §11.

## 1. Цель

Закрыть follow-up'ы фото организатора кофе-райда (ADR-0028 «Последствия», task ride-photo §12):

1. Фото в шапке карточки райда (`/rides/<id>`) и на OG-картинке райда.
2. Уже выданные картинки приглашения со снятым фото и картинки скрытого райда перестают открываться (сейчас живут в
   Redis до 24 ч — принятый риск ADR-0028).
3. Организатор получает уведомление, когда модератор удалил фото его райда (R10).
4. Модератор видит фото и у скрытого райда (R11 b) — вместо плашки «Фото скрыто вместе с райдом».

## 2. Scope / Out of scope

### Scope

- **(1a) Приложение, карточка райда.** `rides/[id]` → `RideDetailScreen` → `SectionHero` получает `photo`
  (`api.ridePhotoUrl(ride.photo.id)`), как герой ленты/Главной: фото `cover` по центру, `PhotoScrim` (`photoScrimHero`),
  текст `onPhoto`; не загрузилось — типографский герой. iOS, Android, web (SSR рендерит тот же `<img>`).
- **(1b) OG-картинка райда.** `og-card` вида `ride`: фото `cover` 1200×630 → скрим → текстовый слой (тот же
  `ogCardTree`, прозрачный фон, цвета `onPhoto`) → PNG с палитрой. `photoId` в OG-хэше райда, `OG_CARD_POLICY.
  renderVersion` 3 → 4. Нет фото / скрытый / отменённый — как сейчас.
- **(2) Инвалидация PNG приглашения** (`story-cards/<token>.png` от `ride-invite.render`, оба шаблона): привязка
  токена к `(rideId, photoId)` в Redis и проверка актуальности при каждой отдаче. OG — не кэшируется по токену и уже
  перечитывает факты при каждой выдаче (см. §5 «OG»), правок механизма не требует.
- **(3) Уведомление `ride_photo_reset`** организатору при «Удалить фото» в панели: тип в contracts, событие outbox
  `rides.photo-reset` в транзакции сброса, текст в `notification-texts.ts`, группа «Райды», схлопывание по райду.
- **(4) Фото скрытого райда в панели.** `GET /v1/admin/rides/:id/photo?photoId=<id>` под `PanelGuard` +
  `rides.moderate`, `private, no-store`; панель показывает картинку у любого статуса (у скрытого — с пометкой).

### Out of scope

- Уведомления организатору о скрытии/возврате **райда** (`ride_hidden`/`ride_restored`) — отдельное продуктовое
  решение, 8.1 R5.
- Отзыв HTTP-кэша браузера и копий картинки, уже сохранённых/отправленных пользователями (технически невозможно, 8.1 R2).
- Отзыв картинок приглашения отменённых и прошедших райдов, правок текста райда (как сейчас: капабилити-ссылка на
  снимок публичных полей).
- Запрет повторной загрузки после сбросов, очистка фото по сроку (R12 ride-photo), сверка скрима с прототипом
  (прототипов в репозитории нет), фото в списке по дням, S3/CDN.
- Изменение публичной отдачи `GET /v1/ride-photos/:id` и `RIDE_PHOTO_CACHE_CONTROL`.

## 3. Acceptance criteria

- **AC1 (шапка).** Карточка райда с `ride.photo` показывает фото под затемнением в блоке `SectionHero` (текст —
  `onPhoto`, фото декоративное, `alt=""`); без фото и у скрытого (`photo: null`) — типографский герой; ошибка картинки —
  типографский. Все платформы, web — и при SSR.
- **AC2 (OG с фото).** `GET /v1/og/cards/ride/:id` после загрузки фото возвращает новую `version`; PNG по ней —
  1200×630 с фото под затемнением, ≤ `OG_CARD_POLICY.maxPhotoPngBytes` (шумная фикстура). Удаление/замена/сброс фото —
  снова новая `version`, старая — `302` на текущую; PNG со снятым фото по API больше не отдаётся. Скрытый — `404`,
  отменённый — как сейчас (бренд у SSR). Райд без фото — картинка как до задачи (кроме версии рендера в хэше).
- **AC3 (инвалидация приглашения).** Токен PNG приглашения, выданный до события, после события отдаёт `404` JSON:
  - `night` с фото — после замены, удаления организатором, сброса модератором, стирания аккаунта;
  - любой шаблон — пока райд скрыт.
  Не затронуты: `line` при смене фото; `night` без фото при добавлении фото; карточки сторис гонки, достижения,
  маршрута. После «Вернуть» статус карточки выдаёт рабочий токен (перерендер). Гонка «рендер ↔ сброс» (фото снято
  между `invitePhoto` и записью PNG) — токен тоже `404`.
- **AC4 (уведомление).** «Удалить фото» в панели → в центре организатора `ride_photo_reset` «Фото райда удалено» с
  названием райда, группа «Райды», цель — карточка райда; push по настройкам группы. Повторный сброс (после новой
  загрузки) заменяет непрочитанное уведомление (N7), более раннее событие не заменяет более позднее. Фото нет / 409 /
  откат транзакции — ни события, ни уведомления. Удалённый организатор — без уведомления.
- **AC5 (панель, API).** `GET /v1/admin/rides/:id/photo?photoId=` с `rides.moderate` — `image/jpeg` текущего фото
  райда **любого** статуса, `Cache-Control: private, no-store`, `nosniff`, `CSP: default-src 'none'; sandbox`;
  `photoId` не текущий / фото нет / райда нет — `404` JSON; без права — `403`; без сессии — `401`; лишний или кривой
  query — `400`. Публичный `GET /v1/ride-photos/:id` скрытого — по-прежнему `404`.
- **AC6 (панель, UI).** Карточка модерации показывает фото по админскому адресу у любого статуса; у скрытого — с
  пометкой «Райд скрыт — райдеры это фото не видят»; ошибка — прежнее «Фото недоступно» + «Повторить» / «Обновить
  карточку». CSP панели не меняется (`img-src 'self'`).
- **AC7.** Старые сборки приложения: незнакомый `kind` → `unknown` (`tolerantEnum`), заголовок и текст показываются;
  контракт OG-адреса (`<version>.png`) прежний.

## 4. Продуктовые решения (все `[ASSUMPTION]`, кроме явно отмеченных)

- **P1. Шапка карточки — тот же герой, что в ленте.** Профиль скрима — `photoScrimHero`, без новых токенов. Фото видно
  всем, кто видит карточку (как в ленте); у скрытого — нет (view отдаёт `null`).
- **P2. OG с фото — тот же макет.** Колонка текста слева и плитка линии маршрута справа (если линия есть) поверх фото;
  все цвета — `onPhoto` схемы вида (`ride` → `light`), скрим — `overlay.scrim` той же схемы с профилем
  `photoScrimHero` (контраст ≥ 4.5:1 по всей высоте уже доказан тестом токена для обеих схем всех тем). Прошедший
  опубликованный райд — тоже с фото (OG отдаётся у любой фазы опубликованного).
- **P3. Что отзывается (п. 2).** Картинка приглашения отзывается, если райд скрыт или фото на картинке больше не
  текущее. Отменённый/прошедший райд и правки текста — нет (как раньше). Скрытие отзывает и `line`: «скрытый — 404
  всем» уже правило приглашения.
- **P4. Уведомление — только о сбросе фото.** Скрытие/возврат райда организатору не сообщаются (как сейчас: баннер в
  карточке); см. 8.1 R5.
- **P5. Текст уведомления** (снимок при приёме): заголовок «Фото райда удалено»; текст «Модератор удалил фото райда
  «{райд}».» + «Можно загрузить другое, пока райд не начался.» — только если райд при приёме опубликован и ещё не
  начался (иначе загрузка невозможна: 409). Без причины модератора (N12, как сброс профиля). Без письма.
- **P6. Панель — фото по админскому адресу у любого статуса** (одна ветка UI, картинка привязана к `photoId` карточки,
  не зависит от публичной видимости); у скрытого — пометка. Просмотр не журналируется (чтение карточки модерации не
  журналируется нигде).
- **P7. Текст последствий «Удалить фото»** в панели обновляется: выданные картинки приглашения с этим фото перестают
  открываться; сохранённое на устройствах может держаться до суток; организатор получит уведомление.

## 5. Placement и устройство

**Как устроено сейчас (проверено кодом).**
- Приглашение: `RideInviteService.status` → `RideInviteInputs.resolve` (порт `RIDES_FOR_SHARING.inviteFacts`, скрытый —
  404) → `rideInviteHash` (в ключе `photoId` у `night`) → `CardRequests.status` (`StoryCardCache.readyToken(hash)` /
  `claim` / очередь `story-card`) → worker `StoryCardProcessor.buildRideInvite` (перепроверка хэша и `invitePhoto`) →
  `StoryCardCache.storeReady(hash, png)` (`story-card:png:<token>` + `story-card:token:<hash>`, TTL 24 ч). Отдача —
  `StoryCardImageController` (`GET story-cards/:file`, без входа, IP-лимит) читает **только** `story-card:png:<token>`
  — ни райда, ни фото не проверяет. Это и есть дыра п. 2.
- OG: `OgCardService.image(kind, id, version)` на **каждый** запрос перечитывает факты (`ogFacts`: скрытый/отменённый
  → `null` → 404) и считает текущую версию; несовпавшая — `302`; PNG — по хэшу (`og:png:<hash>`), новая версия объекта
  удаляет PNG прежней (Lua `STORE_READY`). Значит, как только `photoId` войдёт в хэш, PNG со снятым фото по API
  недостижим сразу после смены (до рендера новой — бренд-заглушка). Отдельная инвалидация OG не нужна. Публичный
  HTTP-кэш OG (`public, max-age=86400`) и кэши превью соцсетей не отзываются (8.1 R2).
- Сброс фото: `RidesModerationService.resetPhoto` — транзакция «`RidesRepository.resetPhoto` (условие `photoId`) →
  `RidePhotosRepository.delete` → `PanelAudit` `ride.photo_reset`», outbox нет.
- Уведомления: образец — `profile.field-reset` (`ProfileModerationService.reset`: outbox в транзакции сброса, `seq` —
  ревизия) → `notificationsOutboxRoutes` → `NotificationIntake.profileFieldReset` (`collapse: { key, seq }`). Райды —
  порт `RIDE_NOTICES` (`ride(rideId)` → `title`, `status`, `startsAt`, `organizerUserId`), `noticeSeq` райда —
  монотонный счётчик событий, `$inc`-ится условными записями. Уведомления о скрытии/возврате райда **нет** (и
  `notifications-intake.int.test.ts` явно держит `rides.ride-hidden` неизвестным типом).
- Панель: сессия — httpOnly cookie `__Secure-pokatim_admin_sid`, `path: /v1/admin`, `SameSite=Strict`, тот же origin
  (`createAdminApiClient({ baseUrl: '' })`, Vite проксирует `/v1`) → обычный `<img src="/v1/admin/...">` несёт cookie;
  CSP панели `img-src 'self' data: blob:` (`infra/docker/admin-nginx.conf`, сторож `apps/admin/src/csp.test.ts`).
  Blob не нужен (8.1 R8).

**Целевая схема.**

| Пункт | Приложение / модуль / слой | Что |
|---|---|---|
| 1a | `apps/app` → `features/rides/ride-detail.tsx` (компонент экрана) | `SectionHero photo` |
| 1b | `apps/api` → `modules/sharing` (worker: `og-card.png.ts`, `story-card.processor.ts`; HTTP/worker: `og-card.inputs.ts`) | фото в хэше и рендере; байты — порт `RIDES_FOR_SHARING.invitePhoto` (тот же смысл: текущее фото нескрытого) |
| 1b | `modules/sharing/photo-card.png.ts` (новый, чистые функции) | общая композиция «фото → скрим → текст → палитра» для 4a и OG (вынос из `ride-invite.png.ts`) |
| 2 | `modules/sharing` (HTTP: `story-card-image.controller.ts` + новый `story-card-image.service.ts`; кэш `story-card.cache.ts`; worker `story-card.processor.ts`) + порт `rides` `inviteCardLive` | привязка токена и проверка при отдаче |
| 3 | `modules/rides` (сервис модерации, репозиторий, события) → outbox → `modules/notifications` (intake, тексты, политика, маршруты) | событие и уведомление |
| 4 | `modules/rides` (`RidesModerationController` GET, `RidePhotosService.moderationBytes`) + `apps/admin` | отдача и показ |

Новых пакетов, модулей, коллекций, очередей — нет. В app-foundation — ничего (всё доменное).

**Механизм п. 2 (рекомендация 8.1 R1 a).**
- `StoryCardCache.storeReady(hash, png, binding?)` — при `binding` в той же `MULTI` пишет `story-card:ride:<token>` =
  JSON `{ rideId, photoId }` с тем же TTL (`pngTtlSec`). `photoId` — id фото, **нарисованного** на картинке (`night` с
  фото), иначе `null`.
- `StoryCardProcessor.buildRideInvite` — свой `OutcomeSink` со `storeReady: (hash, png) => cache.storeReady(hash, png,
  { rideId: job.rideId, photoId: photo ? photoId : null })`. Остальные виды карточек — без привязки.
- `StoryCardImageService.png(token)`: `cache.png(token)` → нет — `null`; `cache.binding(token)` → нет — PNG как раньше
  (сторис гонки, достижение, маршрут; токены приглашений, выданные до выката, — 24 ч переходного окна, 8.1 R2);
  привязка не разбирается схемой — отказ (fail closed); иначе `rides.inviteCardLive(rideId, photoId)` → `false` —
  `cache.revoke(token)` (DEL png + привязки), лог `story-card revoked ride=<id>` (без токена и id фото), `null`.
- `RidesForSharing.inviteCardLive(rideId, photoId: string | null): Promise<boolean>` → `RidesRepository.isShareable`:
  `findOne({ _id, status: { $ne: 'hidden' }, ...(photoId ? { photoId } : {}) }, { projection: { _id: 1 } })`.
  `isCurrentPhoto` выражается через него (без копии фильтра).
- Почему нет гонок: проверка на каждой отдаче против текущего документа; PNG, записанный после сброса (рендер начался
  до), несёт старый `photoId` → `404`. Статус карточки (`readyToken`) не меняется: хэш содержит `photoId`, скрытый → 404
  порта; отозванный PNG удалён → `readyToken` → `null` → перерендер.

**OG с фото.**
- `canonicalFacts` вида `ride` — `+ f.photoId` в конец; `OG_CARD_POLICY.renderVersion` 4 (полный проход `og.sync`).
  `og.sync` уже видит смену фото: `setPhoto`/`clearPhoto`/`resetPhoto`/`clearPhotosOf` пишут `updatedAt`.
- `buildOgCard`: для `ride` с `photoId` — `rides.invitePhoto(id, photoId)`; `null` → `skipped` (вход устарел).
- `renderOgCard(input, line, photo = null)`: без фото — как сейчас; с фото — `composeWithPhoto(photo, textSvg, {
  size: ogCard.size, scrimColor: scheme.overlay.scrim, profile: photoScrimHero, maxBytes: OG_CARD_POLICY.
  maxPhotoPngBytes })`, текст — `ogCardTree(ogCardRenderInput(input, line, { photo: true }))` с `onPhotoColors`.
- `photo-card.png.ts`: `onPhotoColors`, `scrimSvg(color, size, profile)`, `layerPng`, `PHOTO_CARD_PALETTES`,
  `encodePhotoCard(frame, maxBytes)`, `composeWithPhoto(photo, textSvg, opts)` — перенос из `ride-invite.png.ts`
  без изменения поведения 4a (размер `storyCard.size`, профиль `photoScrim`, `STORY_CARD_POLICY.maxPngBytes`).

**Уведомление.**
- `RidesRepository.resetPhoto` — `+ $inc: { noticeSeq: 1 }` (документ после записи несёт `noticeSeq`).
- `RidesModerationService.resetPhoto` — после `PanelAudit.append` в той же транзакции `outbox.append(tx, { type:
  RIDES_PHOTO_RESET, payload: { rideId, seq: updated.noticeSeq } })`. Ветки «фото нет» (200 без журнала) и 409 —
  без события.
- `NotificationIntake.ridePhotoReset(payload, now)`: схема → `rides.ride(rideId)` (нет — `gone`) → черновик `{ text: {
  kind: 'ride_photo_reset', ride: title, canReplace: status === 'published' && startsAt > now }, target: { type:
  'ride', rideId }, collapse: { key: "ride:<id>:photo-reset", seq }, recipients: [organizerUserId] }`. Статус
  райда не фильтрует (скрытый организатору виден — цель работает). Живость получателя — как у всех (`liveUserIds`).

**Отдача фото панели.**
- `RidesModerationController` `@Get(':id/photo')`: `idPipe`, `@Query(ModerationRidePhotoQuery)`, `@Res({
  passthrough: true })` → `RidePhotosService.moderationBytes(id, query.photoId)` → `replyJpeg(adapter, reply, bytes,
  RIDE_PHOTO_MODERATION_CACHE_CONTROL = 'private, no-store')`. Guard и право — с класса (сторож
  `admin-routes.test.ts`).
- `moderationBytes(rideId, photoId)`: `RidePhotosRepository.findBytes(photoId)` с `rideId` совпадает и
  `RidesRepository.hasPhoto(rideId, photoId)` (`{ _id, photoId }`, любой статус) → иначе `404`. Общий приватный
  `bufferOf(binary)` с `bytes(id)` — без копии.

## 5.1 Placement & Reuse Gate

- **Reuse (обязательно).** `SectionHero`/`PhotoScrim`/`photoScrimHero` (приложение); `encodePhotoCard`,
  `PHOTO_CARD_PALETTES`, `scrimSvg`, `onPhotoColors`, `composeWithPhoto` (перенос, не копия); `renderCardSvg`/
  `renderCardPng`/`storyCardFonts`; `RIDES_FOR_SHARING.invitePhoto` (OG); `OutcomeSink` процессора; `replyJpeg`;
  `RidePhotoId`; `RideEventPayload`-подобная схема рядом (`rides.events.ts`); `MongoOutboxWriter`; `NoticeDraft.collapse`;
  `quoted`; `notificationsOutboxRoutes`; `PanelGuard`/`RequirePermission` с класса; `PhotoImage` панели.
- **Запрещённые дубли.** Второй скрим-SVG/энкодер палитры в `og-card.png.ts`; новый токен скрима под OG; фильтр «райд
  не скрыт и фото текущее» в двух местах (`isShareable` — один); своя установка заголовков JPEG; новый guard панели;
  копия `PhotoImage`; клиентский DTO вне contracts; немедленная очистка токенов из `rides` (цикл `rides → sharing`).

## 6. Контракты и данные

**Contracts (`packages/contracts`).**
- `notifications/notification.schema.ts`: `'ride_photo_reset'` — **в конец** `NOTIFICATION_KINDS` (справочник читается
  `tolerantEnum`; старые сборки → `unknown`, текст с сервера). Конфликт с параллельными сессиями «Свои» (тоже пишут в
  конец) — разрешать порядком merge, позиция — после последнего на момент merge.
- `rides/ride-moderation.schema.ts`: `ModerationRidePhotoQuery = z.strictObject({ photoId: RidePhotoId })`.
- OG, story-card, `RideDetail` — без изменений (`RideDetail.photo` уже есть с ride-photo PR A).

**api-client.** `admin.ts`: `moderationRidePhotoUrl(rideId, photoId)` → `${baseUrl}/v1/admin/rides/${enc(rideId)}/photo?
photoId=${enc(photoId)}` (PR A); `ridePhotoUrl` в админском клиенте удаляется в PR B, когда панель с него уйдёт.

**i18n (`packages/i18n`).** PR A: `admin.ridesModeration.resetPhotoConsequences` (P7 — правда меняется вместе с API).
PR B: `admin.ridesModeration.photoHidden` → «Райд скрыт — райдеры это фото не видят». Тексты уведомления — сервер
(`notification-texts.ts`, RC-9), не каталог.

**События outbox.** `rides.photo-reset` (`rides.events.ts`): `RidesPhotoReset = z.strictObject({ rideId: z.uuid(),
seq: z.number().int().positive() })` — только id и ревизия (RC-3). Маршрут — `notificationsOutboxRoutes` (подписчик
объявляет), `outbox-routes.ts` сам не меняется. jobId = id события (идемпотентность приёма — как у всех).

**MongoDB.** Миграций нет: новых коллекций и индексов нет; `noticeSeq` уже есть (`$inc` по отсутствующему полю → 1).
Последняя миграция на `origin/develop` — `0049_route_rides_leaderboard_idx`. Поиск `{ _id, photoId }` / `{ _id, status }`
— по `_id`.

**Redis.** Новый ключ `story-card:ride:<token>` (JSON ≈ 100 байт, TTL `pngTtlSec` 24 ч) рядом с `story-card:png:<token>`.
OG с фото — PNG до `maxPhotoPngBytes` (600 000) вместо ≤ 300 000; только у райдов с фото в окне пререндера (14 сут).

**Env/конфиги.** Нет. CSP панели и приложения — без изменений.

## 7. Асинхронность и безопасность

**Очереди.** Новых нет. `notifications-intake` получает `rides.photo-reset` (ретраи и финальный провал — как у всех
событий приёма: задача outbox, ошибки в логах воркера, уведомления нет). `story-card`/`og-card.render` — прежние
ретраи; фото снято между постановкой и рендером — `skipped`.

**Серверный авторитет.** Клиент ничего не решает: актуальность картинки, текст уведомления, `canReplace`, фото в OG —
сервер. Панель шлёт `photoId` из карточки только как условие (несовпадение — 404/409).

**Security checklist (обязателен: `modules/rides/**`, `modules/sharing` story-cards, панель — `pokatim-security.md`).**
- AuthN/AuthZ: `GET /v1/admin/rides/:id/photo` — `PanelGuard` + `rides.moderate` на классе, `no-store` от guard и
  `private, no-store` в ответе; публичная отдача скрытого — по-прежнему 404. `story-cards/:file` — без входа, как было,
  плюс проверка райда.
- Ввод: `Uuid` pipe id, `ModerationRidePhotoQuery` strict (лишние ключи — 400); в фильтры — примитивы после zod;
  привязка из Redis разбирается zod, мусор — отказ.
- Данные наружу: админ получает байты только текущего фото по паре `(rideId, photoId)`; заголовки `replyJpeg`
  (`nosniff`, `sandbox`) после чтения, 404 — JSON. В payload события — только `rideId`, `seq`. В тексте уведомления —
  название своего райда, без причины модератора.
- Злоупотребления: отдача PNG приглашения — +1 чтение Mongo по `_id` под прежним IP-лимитом `story-card-image`
  120/мин; панель — под сессией.
- Логи: `story-card revoked ride=<id>` без токена и id фото; ни id фото, ни названий в логах модерации и приёма.
- Аудит: просмотр фото панелью не журналируется (P6); `ride.photo_reset` — прежний.
- Принятые риски (обновить в ADR-0028 и `pokatim-security.md`): HTTP-кэш браузера (`private, max-age=86400,
  immutable`) у получившего картинку устройства и файлы, уже сохранённые/отправленные, не отзываются; токены
  приглашений, выданные до выката, — без привязки до 24 ч; OG — публичный HTTP-кэш и кэши превью соцсетей.

## 8.1 Requirements Consistency (architect)

Блокеров нет. Находки — с рекомендацией (принимается как `[ASSUMPTION]`, если человек не решит иначе):

- **R1. Механизм инвалидации.** (a) **привязка токена к `(rideId, photoId)` + проверка при отдаче** — синхронно, без
  событий, закрывает все триггеры (замена, удаление, сброс, скрытие, стирание) и гонку «рендер ↔ сброс»; цена — одно
  чтение Mongo по `_id` на отдачу PNG приглашения — **рекомендую**; (b) индекс токенов `story-card:ride-tokens:<rideId>`
  + удаление при событии: `rides` не может звать `sharing` (цикл), значит событие outbox и обработчик в worker —
  задержка, гонка с рендером в полёте (PNG пишется после очистки), событие нужно и на скрытие, и на стирание; (c)
  сократить TTL приглашений до 1 ч — окно остаётся, рендеров больше.
- **R2. Что нельзя отозвать — честно.** `Cache-Control: private, max-age=86400, immutable` у PNG карточек: устройство,
  уже скачавшее картинку, держит её до суток; скачанный/отправленный файл — навсегда. Варианты: (a) заголовок не менять
  (приватный кэш одного устройства того, кто запросил карточку, — обычно организатор) — **рекомендую**; (b) `private,
  no-cache` для привязанных токенов — без ETag это полная перекачка ~0,2–2 МБ на каждый показ; (c) `max-age=300` —
  окно 5 мин ценой перекачек. Плюс переходное окно: токены приглашений до выката без привязки — до 24 ч (отличить их от
  токенов сторис нельзя). Записать в ADR-0028 «Принятые риски» вместо прежнего «до 24 ч в Redis».
- **R3. Размер OG с фото.** `OG_CARD_POLICY.maxPngBytes` 300 000 рассчитан на плоскую графику; фото 1200×630 палитрой
  256 — ориентировочно 300–600 КБ, шум 8 бит ≈ 760 КБ, 4 бита ≈ 380 КБ. (a) **отдельный `maxPhotoPngBytes: 600_000`,
  палитры `[256, 16]` тем же `encodePhotoCard`**, проверка на шумной фикстуре — **рекомендую**; (b) прежние 300 КБ —
  почти всегда 16 цветов (заметная постеризация); (c) JPEG для OG — смена контракта `OgImageFile` (`.png`) и
  `Content-Type`, отклонить. Замер — в тесте; не влезает и 16 цветов — поднять предел решением человека, не молча.
- **R4. Макет и скрим OG — прототипа нет.** (a) **тот же макет, `photoScrimHero` (контраст по всей высоте уже
  проверен для обеих схем всех тем), цвета `onPhoto`** — **рекомендую**; (b) новый горизонтальный токен (темнее слева
  под колонкой) — новый токен и тест, решение дизайна; (c) без плитки линии на фото. Значения — `[ASSUMPTION]`, как
  все скримы ride-photo; превью — `preview:story-cards`.
- **R5. «Уведомление, когда фото скрыли или вернули».** Отдельного уведомления о скрытии/возврате райда нет и намеренно
  (`notifications-intake.int.test.ts`: `rides.ride-hidden` — неизвестный тип; `notifications.md` — нет строки). Фото
  «скрывается» только вместе с райдом. (a) **в этой задаче — только сброс фото (R10), скрытие/возврат райда — отдельное
  продуктовое решение (follow-up)** — **рекомендую**; (b) добавить `ride_hidden`/`ride_restored` организатору сейчас —
  новые тексты и семантика (сообщать ли «Вернуть», участникам ли), рост scope; (c) упоминать фото в будущем
  уведомлении о скрытии.
- **R6. Текст и призыв.** «Загрузите другое фото» (как у аватара) ложен для прошедшего/отменённого/скрытого (загрузка
  — 409). (a) **условная вторая фраза по `published && startsAt > now` при приёме** — **рекомендую**; (b) одна фраза
  без призыва; (c) всегда с призывом. «После жалоб» не пишем: сброс фото не привязан к жалобам (R10 ride-photo).
- **R7. Порядок схлопывания.** (a) **`seq` = `noticeSeq` райда после записи сброса (`$inc` в условной записи)** —
  монотонно внутри райда, как события переноса/участника — **рекомендую**; (b) время сброса — не монотонно между
  конкурирующими транзакциями (урок `profile.field-reset`, ревью pass 2); (c) без схлопывания — каждое снятие отдельной
  строкой. `$inc noticeSeq` безопасен для `participantsDraft` (фильтр `seq ≤ события` монотонен).
- **R8. Панель: blob или прямой `<img>`.** Cookie панели `path: /v1/admin`, `SameSite=Strict`, тот же origin —
  `<img src="/v1/admin/rides/:id/photo?photoId=…">` несёт сессию. (a) **прямой `<img>` по админскому адресу у любого
  статуса** (один путь, состояние `PhotoImage` переиспользуется, CSP не меняется) — **рекомендую**; (b) `fetch` → Blob →
  `URL.createObjectURL` (нужен `revokeObjectURL`, своё состояние загрузки; `img-src blob:` уже есть); (c) админский
  адрес только у скрытого, публичный — у остальных (две ветки). 401 у картинки — прежнее «Фото недоступно».
- **R9. Привязка запроса панели к `photoId`.** (a) **`photoId` обязателен в query, не текущий — 404** (модератор
  видит ровно то фото, которое удалит; совпадает с 409 сброса) — **рекомендую**; (b) «текущее фото райда» без
  `photoId` — картинка может разойтись с id в карточке; (c) путь `/photos/:photoId`.
- **R10. `renderVersion` OG.** Добавление `photoId` в канонический массив и так меняет хэши всех райдов; подъём версии
  (по правилу `pokatim-backend.md`: изменилась разметка) запускает полный проход `og.sync` по всем видам (≤ 60
  рендеров за прогон) и перерисует гонки/маршруты/старты без изменений. (a) **поднять до 4** (правило + пререндер
  райдов в окне) — **рекомендую**; (b) не поднимать — райды без пререндера до первого запроса (бренд-заглушка).
- **R11. Параллельные сессии.** `origin/develop` уже содержит #184 (social P5: `rides/index.ts`, `rides.repository.ts`,
  `outbox-routes.ts`) — merge до кода; конец `NOTIFICATION_KINDS` и `notifications.events.ts` — общие точки с «Свои».
  Файлы social/route-rides/гонок не трогаем.
- **R12. Ветка.** `ride-photo-followups` без префикса `feature/` (AGENTS §7) — оставить (уже создана оркестратором) или
  PR из `feature/ride-photo-followups`; решает оркестратор.
- **Согласованность с ADR.** ADR-0028: принятые риски «PNG приглашения до 24 ч» и «follow-up OG/шапка» закрываются,
  дополнение (без нового ADR — механизм локален для `sharing`). ADR-0018: OG с фото — дополнение, правило
  `renderVersion` соблюдено; капабилити-ссылка карточек сохраняется, у приглашений — с проверкой актуальности.
  ADR-0017: событие через outbox в транзакции действия, подписчик объявляет маршрут. ADR-0009: панель — только cookie,
  новый guard не нужен. Конфликтов с инвариантами §4 нет.

## 8.2 Deviations from spec

PR A (coder, 2026-11-01):

- **D1. Разбивка коммитов.** `ride_photo_reset` в `NOTIFICATION_KINDS` — в коммите уведомления, а не в первом
  коммите contracts: `KIND_GROUPS`/`TITLES` — `Record<NotificationKind, …>`, иначе промежуточный коммит не проходит
  typecheck API.
- **D2. Отрицательное доказательство отката сброса.** Сбой подставлен в `RideReportsRepository.latest` (последний шаг
  транзакции после журнала и события), а не в `PanelAudit.append`: журнал пишется **до** события, и с append outbox вне
  транзакции тест со сбоем журнала не покраснел бы.
- **D3. Фикстура шумного фото** `noisyPhoto` перенесена из `ride-invite.png.test.ts` в `test/avatars.ts` (общая для 4a и
  OG); `encodePhotoCard` без значения предела по умолчанию — предел передаётся явно (4a — `STORY_CARD_POLICY.
  maxPngBytes`, OG — `OG_CARD_POLICY.maxPhotoPngBytes`).
- **D4. `story-card.int.test.ts` не менялся.** «Без привязки — 200» покрыт в `ride-invite.int.test.ts` (ключ привязки
  удалён, райд скрыт — PNG отдаётся) и прежними тестами сторис гонки (зелёные без правок); `rides-for-sharing.int.test.ts`
  — новый кейс `inviteCardLive`.
- **D5. OG на шумной фикстуре влезает только палитрой 16** (≈ 296 КБ при пределе 600 КБ; 256 цветов — больше
  предела). Предел не поднимался (условие задачи соблюдено); реальные фото, как правило, — палитра 256.
- **D6. `pokatim-web.md`, `pokatim-app.md`** не менялись в PR A — их содержание (панель, шапка) — PR B.

PR B (coder, 2026-11-01):

- **D7. Тест центра уведомлений `ride_photo_reset`** (`notifications.test.tsx`) — сверх матрицы: проверка, что кода в
  приложении не нужно (текст сервера, цель `ride` → `/rides/<id>`). Зелёный сразу, без правок кода — регрессионный.
- **D8. Пометка у скрытого** — класс `.ride-photo-preview__note` (`display: block`, отступ `--space-s2`) вместо голого
  `t-meta`: иначе строка встаёт вплотную к картинке. Токенов не добавлено.
- **D9. Тест api-client** на отсутствие `ridePhotoUrl` не добавлялся (тавтология): удаление держит typecheck панели.

## 9. Test matrix

Int-тесты — реальные mongod `127.0.0.1:27117` (rs0) и redis `6479` через `test/harness.ts`, своя БД/Redis db на сессию
(`MONGO_URL_TEST=…/ridephotofu_test…`, `REDIS_URL_TEST=redis://127.0.0.1:6479/<свой>`). Каждый тест инвалидации и гонки —
с **отрицательным доказательством** (временно убрать механизм → тест красный по результату, код вернуть, `git diff`
файла пуст; записать вывод в §12).

| Уровень | Файл | Что |
|---|---|---|
| unit | `packages/contracts/src/notifications/notification.schema.test.ts` | `ride_photo_reset` в конце списка; старый клиент: незнакомый kind → `unknown` |
| unit | `packages/contracts/src/rides/ride-moderation.schema.test.ts` | `ModerationRidePhotoQuery`: strict, кривой/пустой `photoId` — ошибка |
| unit | `packages/api-client/src/ride-photo.test.ts` | `moderationRidePhotoUrl` (кодирование) |
| unit | `sharing/og-card.inputs.test.ts` | убрать пропуск `ride.photoId` в цикле «каждое поле меняет ключ»; кейс «`photoId` ключ OG не меняет» → «меняет»; `renderVersion` в хэше |
| unit | `sharing/og-card.png.test.ts` | с фото: PNG 1200×630, ≤ `maxPhotoPngBytes` на шумной фикстуре (`test/avatars.ts`), палитра; без фото — как раньше |
| unit | `sharing/ride-invite.png.test.ts` | без изменений ожиданий после выноса в `photo-card.png.ts` (импорты) |
| unit | `sharing/story-card-image.service.test.ts` (новый, моки кэша и порта) | без привязки — PNG; привязка жива — PNG; не жива — `revoke` + `null`; мусор привязки — `null`; нет PNG — порт не зовётся |
| unit | `notifications/notification-texts.test.ts` | `ride_photo_reset` с `canReplace` true/false — заголовок и текст; кавычки и одна строка названия |
| unit | `notifications/notification-intake.test.ts` | черновик: получатель — организатор, цель `ride`, `collapse` `ride:<id>:photo-reset` + `seq`; райда нет — `gone`; кривой payload — `invalid_payload`; `canReplace` по статусу и `now` |
| unit | `notifications/notifications.policy.test.ts` | `ride_photo_reset` → `rides`, не в `EMAIL_KINDS` |
| int | `sharing/ride-invite.int.test.ts` | AC3: `night` с фото → токен; замена фото / удаление организатором / сброс модератором / стирание — `GET story-cards/<token>.png` 404 JSON, ключи `story-card:png|ride:<token>` удалены; `line` того же райда при смене фото — 200; `night` без фото после добавления фото — 200; скрытие — 404 у обоих шаблонов, после «Вернуть» статус → новый рабочий токен; **гонка**: `invitePhoto` вернул байты, затем сброс коммитится до `storeReady` (spy) → токен 404. Отр. доказательство: без записи привязки в `buildRideInvite` (или без проверки в сервисе) — `expected 404, received 200` |
| int | `sharing/story-card.int.test.ts` | сторис гонки (без привязки) — 200 как раньше; PNG без ключа привязки (переходное окно) — 200 |
| int | `sharing/og-card.int.test.ts` | AC2: версия меняется при загрузке/удалении/сбросе фото, старая — 302; скрытый — 404; рендер с фото (процессор напрямую) — PNG в кэше, 1200×630; фото снято между постановкой и рендером — `skipped`, PNG не записан |
| int | `sharing/og-sync.int.test.ts` | смена фото (`updatedAt`) → `og.sync` ставит рендер нового хэша; `renderVersion` 4 → полный проход (существующий кейс) |
| int | `rides/rides-moderation.int.test.ts` (или `ride-photos.int.test.ts`, блок сброса) | AC4 (источник): сброс → в `outbox` одно `rides.photo-reset` `{ rideId, seq }`, `seq` = `noticeSeq` после записи; фото нет — без события и журнала; чужой `photoId` (409) — без события; откат (сбой `PanelAudit.append`, spy) — ни события, ни журнала, фото на месте. Отр. доказательство отката: append outbox вне транзакции → событие остаётся |
| int | `notifications/notifications-intake.int.test.ts` | AC4: событие → уведомление организатору `ride_photo_reset`, группа `rides`, цель `ride`, текст по фазе; второй сброс (после новой загрузки) заменяет и снова непрочитан; событие с меньшим `seq` после большего — не заменяет (отр. доказательство: без `seq` в `collapse` — заменило); удалённый организатор — нет уведомления; push выключен в группе — центр есть, push skipped |
| int | `rides/ride-photos.int.test.ts` | AC5: админ GET у скрытого и видимого — байты = публичные (у видимого), заголовки `private, no-store`, `nosniff`, `sandbox`, `image/jpeg`; не текущий `photoId` / фото нет / райда нет — 404 JSON без `image/jpeg`; лишний query / кривой id — 400; без `rides.moderate` — 403; без cookie — 401; публичный GET скрытого — 404 (регрессия) |
| unit | `apps/api/src/admin-routes.test.ts` | сторож проходит без правок (guard с класса) |
| unit | `apps/app/src/__tests__/ride-detail.test.tsx` | AC1: `ride.photo` → `section-hero-photo` с `api.ridePhotoUrl(id)`, `photo-scrim`; без фото / скрытый — без фото; ошибка картинки — типографский (поведение `SectionHero`, достаточно одного кейса) |
| unit | `apps/app/src/components/section-hero(.web).test.tsx` | без изменений (поведение уже покрыто) |
| unit | `apps/admin/src/features/rides-moderation/RideModerationScreen.test.tsx` | AC6: `<img>` с `moderationRidePhotoUrl(id, photoId)` у видимого и скрытого; у скрытого — пометка; ошибка — «Фото недоступно» + «Повторить»/«Обновить карточку»; без фото — «Нет фото» |
| unit | `apps/admin/src/csp.test.ts` | `img-src 'self'` — название кейса дополнить «фото райда модерации (/v1/admin/rides/:id/photo)» |
| e2e | — | не нужен: стенда с фото райда нет (как ride-photo PR C); web-превью шапки — ручная проверка, иначе `NOT VERIFIED` |

## 10. Documentation impact

- ADR-0028: «Последствия» — принятые риски переписать (R2), follow-up'ы OG/шапка/инвалидация/уведомление/админская
  отдача — сделано (ссылка на эту задачу); п. 4 — `GET /v1/admin/rides/:id/photo`, сброс пишет outbox.
- ADR-0018: OG райда с фото (`renderVersion` 4, `maxPhotoPngBytes`); приглашение — привязка токена и проверка при отдаче.
- `docs/product/rides.md` (фото в карточке и OG; «Скрыто» обновить), `docs/product/notifications.md` (строка таблицы
  событий «Фото райда удалено модератором — организатору», «Тексты v1», N10 — цель `ride`),
  `docs/product/admin-panel.md` (фото у скрытого, админская отдача, текст последствий).
- `.claude/rules/pokatim-security.md` (раздел «Фото райда и media»: админская отдача, привязка карточек, принятые
  риски; «Карточки для сторис»: проверка приглашений при отдаче), `pokatim-backend.md` (событие `rides.photo-reset`,
  `inviteCardLive`, `StoryCardImageService`, `OG_CARD_POLICY.renderVersion` 4, `photo-card.png.ts`),
  `pokatim-contracts.md` (`ride_photo_reset`, `ModerationRidePhotoQuery`), `pokatim-web.md` (фото модерации по
  админскому адресу), `pokatim-app.md` (шапка карточки райда с фото).
- `pr.md` / `pr-b.md`: без миграций и env; поведение `story-cards` для старых токенов (24 ч).

## 11. Implementation Context

### PR A — API + contracts + api-client + i18n (пп. 1b, 2, 3, 4-эндпоинт)

**ENTRY POINTS.** `GET /v1/story-cards/:file`, задачи `ride-invite.render` и `og-card.render` (worker),
`GET /v1/og/cards|images/ride/...`, `POST /v1/admin/rides/:id/photo-reset`, новый `GET /v1/admin/rides/:id/photo`,
приём `rides.photo-reset` (`notifications-intake`).

**Порядок (TDD, коммиты по шагам).**
1. `git merge origin/develop`; contracts (`ride_photo_reset`, `ModerationRidePhotoQuery`) + тесты; api-client
   `moderationRidePhotoUrl` + тест.
2. Админская отдача: `RidesRepository.hasPhoto`, `RidePhotosService.moderationBytes` (+ `bufferOf`),
   `RidesModerationController.photo` → int-тесты AC5.
3. Уведомление: `rides.events.ts` (`RIDES_PHOTO_RESET`, `RidesPhotoReset`) → `rides/index.ts` экспорт →
   `RidesRepository.resetPhoto` `$inc noticeSeq` → `RidesModerationService.resetPhoto` outbox → `notifications`:
   `notifications.events.ts` маршрут, `notification-texts.ts` (`NoticeText`, `TITLES`, `bodyOf`),
   `notifications.policy.ts` (`KIND_GROUPS`), `notification-intake.ts` (`case RIDES_PHOTO_RESET` →
   `ridePhotoReset`) → unit + int; `i18n` `resetPhotoConsequences`.
4. Инвалидация: `RidesRepository.isShareable` (+ `isCurrentPhoto` через него) → порт `inviteCardLive` →
   `StoryCardCache` (`storeReady(…, binding?)`, `binding`, `revoke`) → `StoryCardImageService` (новый, провайдер
   `SharingModule`) → `StoryCardImageController` через сервис → `StoryCardProcessor.buildRideInvite` sink с привязкой →
   unit + int с отрицательными доказательствами.
5. OG: вынос `photo-card.png.ts` (тесты 4a зелёные без правок ожиданий) → `OG_CARD_POLICY.renderVersion` 4,
   `maxPhotoPngBytes` → `og-card.inputs.ts` (`photoId`) → `og-card.png.ts` (`renderOgCard(…, photo)`,
   `ogCardRenderInput(…, { photo })`) → `buildOgCard` (байты через `invitePhoto`, `null` → `skipped`) → тесты.
6. Доки §10 (часть PR A), `pr.md`, полный `pnpm check`.

**FILES TO MODIFY.**
- `packages/contracts/src/notifications/notification.schema.ts` (+`.test.ts`), `packages/contracts/src/rides/ride-moderation.schema.ts` (+`.test.ts`).
- `packages/api-client/src/admin.ts` (`moderationRidePhotoUrl`), `packages/api-client/src/ride-photo.test.ts`.
- `packages/i18n/src/ru.ts` (`admin.ridesModeration.resetPhotoConsequences`).
- `apps/api/src/modules/rides/{rides.events.ts, index.ts, rides.repository.ts (resetPhoto, hasPhoto, isShareable,
  isCurrentPhoto), rides-moderation.service.ts (resetPhoto), rides-moderation.controller.ts (GET :id/photo),
  ride-photos.service.ts (moderationBytes, bufferOf), ride-photos-public.controller.ts (рядом —
  `RIDE_PHOTO_MODERATION_CACHE_CONTROL`, или в контроллере модерации), rides-for-sharing.port.ts (inviteCardLive, доки
  invitePhoto «4a и OG»), rides-for-sharing.ts}`.
- `apps/api/src/modules/notifications/{notification-intake.ts, notification-texts.ts, notifications.policy.ts,
  notifications.events.ts}`.
- `apps/api/src/modules/sharing/{story-card.cache.ts, story-card-image.controller.ts, story-card.processor.ts
  (buildRideInvite, buildOgCard), og-card.inputs.ts, og-card.png.ts, ride-invite.png.ts (импорты из photo-card),
  sharing.policy.ts, sharing.module.ts (провайдер StoryCardImageService)}`.
- Тесты: `sharing/{og-card.inputs.test.ts, og-card.png.test.ts, ride-invite.png.test.ts (импорты), ride-invite.int.test.ts,
  story-card.int.test.ts, og-card.int.test.ts, og-sync.int.test.ts}`, `notifications/{notification-texts.test.ts,
  notification-intake.test.ts, notifications.policy.test.ts, notifications-intake.int.test.ts}`,
  `rides/{ride-photos.int.test.ts, rides-moderation.int.test.ts}`, `rides-for-sharing.int.test.ts` (`inviteCardLive`).

**FILES TO CREATE.** `apps/api/src/modules/sharing/photo-card.png.ts`, `sharing/story-card-image.service.ts`,
`sharing/story-card-image.service.test.ts`.

**FILES TO READ.** `docs/tasks/2026-10-31-ride-photo/task.md` (§5, 8.2 D5/D7/D10, §12), ADR-0028, ADR-0018 §«OG»,
`profile/profile-moderation.service.ts` (`reset`), `profile/profile.events.ts`, `notification-intake.ts`
(`profileFieldReset`, `ride`), `rides.service.ts` (как событие несёт `noticeSeq`), `story-card.processor.ts` (`run`,
`OutcomeSink`), `og-card.service.ts`, `og-card.cache.ts`, `ride-invite.png.ts`, `test/avatars.ts`, `test/og-fixtures.ts`,
`test/rides.ts`, `test/panel.ts`, `test/notifications.ts`, `admin-routes.test.ts`.

**TYPES & SCHEMAS.**
```ts
// rides.events.ts
export const RIDES_PHOTO_RESET = 'rides.photo-reset';
export const RidesPhotoReset = z.strictObject({ rideId: z.uuid(), seq: z.number().int().positive() });
// rides-for-sharing.port.ts
inviteCardLive(rideId: string, photoId: string | null): Promise<boolean>;
// story-card.cache.ts
export interface InviteCardBinding { rideId: string; photoId: string | null }
storeReady(hash: string, png: Buffer, binding?: InviteCardBinding): Promise<string>;
binding(token: string): Promise<InviteCardBinding | 'invalid' | null>;
revoke(token: string): Promise<void>;
// notification-texts.ts
| { kind: 'ride_photo_reset'; ride: string; canReplace: boolean }
// sharing.policy.ts — OG_CARD_POLICY
renderVersion: 4, maxPhotoPngBytes: 600_000
// contracts
ModerationRidePhotoQuery = z.strictObject({ photoId: RidePhotoId })
```

**OUT OF SCOPE (PR A).** UI приложения и панели; уведомления о скрытии/возврате райда; смена `Cache-Control`
карточек; удаление `ridePhotoUrl` из админского клиента.

### PR B — приложение + панель (пп. 1a, 4-UI)

**Порядок.** После merge PR A (нужен `moderationRidePhotoUrl`) → `git merge origin/develop`.
1. Приложение: `apps/app/src/features/rides/ride-detail.tsx` — `SectionHero photo={ride.photo ?
   api.ridePhotoUrl(ride.photo.id) : null}` (импорт `api` из `@/lib/api`, как `ride-hero.tsx`); JSDoc экрана
   (ride-photo follow-up). Проверить SSR web: `api` на сервере строит тот же абсолютный адрес, что клиент (нет
   расхождения гидрации). Тест `apps/app/src/__tests__/ride-detail.test.tsx`.
2. Панель: `apps/admin/src/features/rides-moderation/RideModerationScreen.tsx` — `RidePhoto`: без фото — «Нет фото»;
   иначе `PhotoImage key={photo.id} src={api.moderationRidePhotoUrl(ride.id, ride.photo.id)}`; у `status ===
   'hidden'` — под картинкой пометка `t('admin.ridesModeration.photoHidden')` (`t-meta`, без новых токенов); JSDoc
   `PhotoImage`/`RidePhoto` (R11 b). `packages/i18n/src/ru.ts` — `photoHidden` «Райд скрыт — райдеры это фото не
   видят». `packages/api-client/src/admin.ts` — удалить `ridePhotoUrl` (+тест), если в панели больше не используется.
   Тесты `RideModerationScreen.test.tsx`, `csp.test.ts` (название кейса).
3. Доки: `docs/product/rides.md`, `docs/product/admin-panel.md`, `pokatim-app.md`, `pokatim-web.md`; `pr-b.md`;
   полный `pnpm check`. Визуальная проверка web-превью шапки и панели — по возможности, иначе `NOT VERIFIED`.

**Текст уведомления в приложении** — не нужен: заголовок и текст приходят с сервера, `kind` приложение не читает.

**OUT OF SCOPE (PR B).** Любые изменения API; e2e (нет стенда с фото).

## 12. Outcome

### PR A (coder, 2026-11-01)

Коммиты (ветка `ride-photo-followups`, не запушено): `c24f2f85` contracts + api-client, `27ef939b` админская отдача фото
(AC5), `181b15c8` уведомление `ride_photo_reset` (AC4), `ba0fe7bf` инвалидация PNG приглашения (AC3) + текст
последствий, `b5a94e4b` вынос `photo-card.png.ts`, `84b9a174` OG с фото (AC2), `9d84ae3b` доки и правила.

- **AC2** — `photoId` в хэше OG, `renderVersion` 4, `maxPhotoPngBytes` 600 000; `og-card.int` (загрузка/замена/удаление/
  сброс → новая версия, старая — 302, PNG прежней вытеснен; скрытый — 404; снято между постановкой и рендером —
  `skipped`), `og-sync.int` (загрузка фото → задача нового хэша), `og-card.png` (шумное фото 296 208 Б, 1200×630; белое
  фото затемнено; без фото — байт в байт прежний рендер).
- **AC3** — привязка `story-card:ride:<token>`, `StoryCardImageService`, порт `inviteCardLive` → `isShareable`;
  `ride-invite.int` (4 триггера `night` с фото, скрытие обоих шаблонов + «Вернуть», незатронутые `line`/`night` без
  фото, переходное окно без привязки, гонка «рендер ↔ сброс»), unit сервиса, `rides-for-sharing.int`.
- **AC4** — `rides.photo-reset` в транзакции сброса (`seq` = `noticeSeq` после `$inc`), приём, текст, группа «Райды»;
  `ride-photos.int` (источник: событие и seq, нет фото/409 — без события, откат), `notifications-intake.int` (организатору,
  без призыва у прошедшего, замена непрочитанного, меньший seq не заменяет, удалённый — нет, push выключен — skipped),
  unit intake/texts/policy.
- **AC5** — `GET /v1/admin/rides/:id/photo?photoId=`; `ride-photos.int` (видимый и скрытый — байты = публичные,
  `private, no-store`, `nosniff`, `sandbox`; не текущий/чужой/нет фото/нет райда — 404 JSON; кривой/лишний query, кривой
  id — 400; без права — 403; без сессии — 401; публичный GET скрытого — 404). `admin-routes.test.ts` — без правок, зелёный.
- **AC6** — PR B. **AC7** — `notification.schema.test.ts` (старый справочник → `unknown`, заголовок/текст/цель целы).
- **i18n** — `admin.ridesModeration.resetPhotoConsequences` (P7).

**Отрицательные доказательства** (механизм временно убран → красный по результату → код восстановлен, файл совпал с
копией):

| Механизм убран | Тест | Результат |
|---|---|---|
| `buildRideInvite` пишет PNG без привязки | `ride-invite.int` «отзыв выданной картинки» | 7 failed: `expected 200 to be 404`, `expected null to deeply equal {…}`, `expected [] to have a length of 1` |
| `StoryCardImageService` не зовёт `inviteCardLive` | то же | 6 failed: `expected 200 to be 404` (все триггеры, скрытие, гонка) |
| `collapse` без `seq` в `ridePhotoReset` | `notifications-intake.int` «более раннее событие» | `expected {…} to match object { sourceEventId: later, collapseSeq: 5 }` |
| outbox `append(undefined, …)` вне транзакции | `ride-photos.int` «откат транзакции» | `expected [ {…} ] to deeply equal []` — событие осталось |
| `photoId` убран из канонических фактов OG | `og-card.int` AC2 | `expected 'c795de92c124f5da' not to be 'c795de92c124f5da'` |

**Полный `TURBO_CONCURRENCY=4 pnpm check`** на `9d84ae3b` (`MONGO_URL_TEST=…/ride_photo_fu_test`, `REDIS_URL_TEST=…/10`):
`Tasks: 15 successful, 15 total` (6 из кэша turbo), api — `Test Files 262 passed`, `Tests 2993 passed`; EXIT=0.

**Фиксы ревью PR A** (`findings-a.md`, `findings-a-codex.md`): HIGH — PNG и привязка читаются одним `MULTI`
(`StoryCardCache.card`), регрессия «revoke между чтениями» в `ride-invite.int` (отр. доказательство — с раздельным
чтением `expected 200 to be 404`); LOW — текст последствий упоминает превью соцсетей.

**NOT VERIFIED:** визуальная проверка OG с фото (превью `preview:story-cards` не запускалось); e2e — не нужен (§9).

### PR B (coder, 2026-11-01)

Ветка `ride-photo-followups-b` (стек поверх PR A #185), не запушено. Коммиты: `4538cbbc` шапка карточки райда (AC1),
`3789b362` тест центра уведомлений `ride_photo_reset`, `f02fc725` панель (AC6) + удаление `ridePhotoUrl` из админского
клиента, `25b76a6f` доки и правила, затем итог (§8.2 D7–D9, §12, `pr-b.md`).

- **AC1** — `ride-detail.tsx`: `SectionHero photo={ride.photo ? api.ridePhotoUrl(ride.photo.id) : null}`; SSR и клиент
  строят тот же абсолютный адрес (`EXPO_PUBLIC_API_URL`). `ride-detail.test.tsx` «фото в шапке»: гость с фото —
  `section-hero-photo` с адресом и пустым alt, `photo-scrim`; вошедший (`me`) — фото, `error` картинки — типографский
  герой; скрытый (`photo: null`) — без фото, `ridePhotoUrl` не вызывается. Сначала красный (`Number of calls: 0`).
  Поведение `SectionHero` (`section-hero(.web).test.tsx`) — без изменений.
- **AC6** — `RidePhoto`: одна ветка у любого статуса — `PhotoImage key={photo.id} src={api.moderationRidePhotoUrl(
  ride.id, photo.id)}`, у `hidden` — пометка `photoHidden` «Райд скрыт — райдеры это фото не видят». Тесты: видимый —
  админский адрес, без пометки; скрытый — та же картинка и пометка, «Удалить фото» и «Вернуть» есть; скрытый с ошибкой
  картинки — «Фото недоступно» + «Повторить» / «Обновить карточку», пометка остаётся; прежние кейсы скелетона, ошибки,
  смены `photo.id`, 409 — на админском адресе. Сначала красные (9 failed). `csp.test.ts` — название кейса.
- **`ride_photo_reset` в приложении** — кода не нужно (§11): тест центра — текст сервера и переход `/rides/<id>`.

**Полный `TURBO_CONCURRENCY=4 pnpm check`** на `25b76a6f` (`MONGO_URL_TEST=…/ride_photo_fu_test`, `REDIS_URL_TEST=…/10`):
`Tasks: 15 successful, 15 total` (9 из кэша turbo); app — `Test Suites 288 passed`, `Tests 2817 passed`; admin —
`Tests 527 passed`; api — `Test Files 262 passed`, `Tests 2994 passed`; EXIT=0.

**NOT VERIFIED:** визуальная проверка шапки с фото на iOS/Android/web (и SSR-HTML в браузере) и карточки панели —
симулятор и превью не запускались; e2e — не нужен (§9).
