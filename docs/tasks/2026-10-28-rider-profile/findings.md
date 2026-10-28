# Findings — rider-profile

## PR A, проход 1

# Findings — rider-profile (PR A) — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop...fba643c (11 коммитов; plan-b.md не в коммитах — вне ревью)
verdict: REQUEST CHANGES

Блокер: HIGH-1. Проверено: unit-тесты `avatar-image.test.ts`, `riders.policy.test.ts`, `profile.repository.test.ts`
(20/20 зелёные, локально). Int-тесты и полный `pnpm check` повторно не запускались: верю отчёту в task.md §12 (NOT
VERIFIED мной). Замер памяти sharp — скрипт в scratchpad на macOS arm64, sharp 0.35.5 из `apps/api`.

### [HIGH] Курсор публичной истории раскрывает точное время суток заезда райдера
- **file:** apps/api/src/modules/riders/riders.policy.ts, apps/api/src/modules/riders/riders.service.ts
- **location:** riders.policy.ts:63–68 (`next: { k: last.startedAt.toISOString(), id: last.raceId }`); riders.service.ts:113 (`encodeCursor(next.k, next.id)`)
- **problem:** `nextCursor` ответа `GET /v1/riders/:publicId/races` (публичный, без входа, `public, max-age=60`) — это
  `base64url(JSON { k, id })` (`page-cursor.ts`: курсор «непрозрачный» только по названию). `k` — `startedAt` строки
  протокола: момент старта лучшего сегмента райдера с точностью до миллисекунды.
- **why_it_matters:** публичная строка протокола по правилу проекта не содержит времени суток
  (`.claude/rules/pokatim-contracts.md`: «публичная строка — … без `userId`, активности, **времени суток**,
  координат»). Время суток вместе с публичным коридором гонки и `elapsedSec` показывает, где и когда человек был.
  Это паттерн жизни, ПДн. Любой посетитель ссылки публичного профиля декодирует курсор каждой страницы, кроме
  последней. В §8.3 task.md «Данные наружу» на это ограничение не обращали.
- **evidence:** `Buffer.from(JSON.stringify({ k: key, id }), 'utf8').toString('base64url')` (`apps/api/src/page-cursor.ts`);
  `PublicRiderRace` специально не содержит `startedAt` (`packages/contracts/src/profile/rider-profile.schema.ts:121`),
  но курсор его несёт. Int-тест `riders.int.test.ts:219` проверяет только порядок и переход по курсору.
- **recommended_fix:** ключ курсора не должен выводиться из времени заезда. Варианты: (a) курсор — только `raceId`
  последней строки (`encodeCursor` с публичным ключом, например `race.windowStartsAt` гонки). Позиция ищется в уже
  отсортированном в памяти списке, сортировка остаётся по `startedAt`. (b) Сортировать и пагинировать по
  `(race.windowStartsAt, raceId)`: окно гонки публично. Добавить int-тест: декодированный `nextCursor` не содержит
  `startedAt` ни одной строки.

### [MEDIUM] Два одновременных 40 Мп аватара — около 280 МБ сверх базы в контейнере API с лимитом 512m
- **file:** apps/api/src/modules/profile/avatar-image.ts, apps/api/src/modules/profile/profile.policy.ts
- **location:** avatar-image.ts:80–108 (`autoOrient().extract().resize()`); profile.policy.ts:16 (`avatarSlots: { maxTotal: 2 }`)
- **problem:** `extract` до `resize` отключает shrink-on-load JPEG, `autoOrient` с поворотом 90° требует всего
  изображения в памяти. Замер (sharp 0.35.5, `cache(false)`, `concurrency(1)`, тот же конвейер, вход 7999×5000 JPEG
  5,5 МБ с orientation 6): одна операция — около +138 МБ RSS, две параллельные (`maxTotal: 2`) — около +282 МБ. Ещё
  до 2×20 МБ дают буферы тела (`readLimited` + `Buffer.concat`).
- **why_it_matters:** у `api` в `infra/deploy/docker-compose.yml:194` лимит `memory: 512m`. База процесса Nest с
  драйвером Mongo плюс 280–320 МБ libvips (на glibc фрагментация malloc больше, чем на macOS) — реальный риск
  OOM-kill всего API. Атаке хватает двух аккаунтов, каждый — 1 слот и 20 загрузок в час. RC-A1 считал
  ограниченность только по времени и слотам, по памяти — нет.
- **evidence:** скрипт `/private/tmp/claude-501/-Users-romankarakulov-PROJECTS-on-bike--claude-worktrees-awesome-grothendieck-891505/1d93987f-3fcc-4316-a5d8-97c30e8f5dc8/scratchpad/mem.cjs`,
  вывод `one 138` / `two delta 282`. На linux/amd64 в образе не проверено (NOT VERIFIED).
- **recommended_fix:** любое из трёх или их сочетание: `maxTotal: 1` на процесс. Снизить `AVATAR_MAX_INPUT_PIXELS`
  (например, 24 Мп, но учесть 48 Мп камеры iPhone в режиме ProRAW/48MP). Для JPEG — предварительный shrink-on-load:
  `sharp(bytes).resize({ width: …, fit: 'inside' })` до кратного 512 масштаба, затем extract. Цифры зафиксировать в
  ADR-0018. Обязательно проверить пик RSS в образе `linux/amd64` (шаг в `pr.md`).

### [MEDIUM] Медленная отправка держит слот аватара до 180 с: два аккаунта блокируют загрузку фото на процессе
- **file:** apps/api/src/modules/profile/profile-avatars.controller.ts
- **location:** :52–58 (`admit` → `readLimited(…, DEFAULT_BODY_TIMEOUTS)`)
- **problem:** у слота `maxTotal: 2, maxPerUser: 1`. Тело — `DEFAULT_BODY_TIMEOUTS` (тишина 30 с, всё тело 180 с), их
  подбирали под 16 МиБ трека на 1 Мбит/с. Аккаунт, который отдаёт по байту раз в 29 с, держит слот 180 с.
  20 загрузок в час × 180 с = 3600 с, то есть ровно час. Два аккаунта держат оба слота процесса постоянно, остальные
  получают `429`.
- **why_it_matters:** злоупотребление (§8.3 «Злоупотребления») — отказ в обслуживании функции фото малой ценой. У
  треков и маршрутов `maxTotal: 4`, у аватара — 2.
- **evidence:** `apps/api/src/raw-body.ts:23`, `apps/api/src/modules/profile/profile.policy.ts:16`.
- **recommended_fix:** свои таймауты аватара (например, `totalMs` 60 с для 10 МиБ). Ещё вариант — `admit` списывает
  частотный лимит только после выдачи слота, а лимит часа считается по занятому времени. Как минимум — отметить
  принятый риск в ADR-0018.

### [LOW] Лимит 20/ч списывается и при отказе «слот занят»
- **file:** apps/api/src/modules/profile/profile-avatar.service.ts
- **location:** :46–51
- **problem:** `consume('profile-avatar:<uid>')` идёт до `tryAcquire`. Повторы клиента после `429 retryAfterSec: 5`
  (второй параллельный приём, PR B) расходуют часовую квоту, хотя ничего не загружено.
- **why_it_matters:** пользователь с медленной сетью и повтором упрётся в 20/ч раньше, чем ожидается.
- **evidence:** код `admit`.
- **recommended_fix:** слот — первым, лимит частоты — после (с `release` при отказе лимита), либо принять и описать.

### [LOW] Публичная статистика считает строки гонок, которых нет в истории
- **file:** apps/api/src/modules/riders/riders.service.ts
- **location:** :66–81 (`publicProfile`) против :93–111 (`publicRaces` отбрасывает строки без `racesOf`)
- **problem:** `stats.races/podiums/bestPlace` считаются по всем строкам `publishedRows`. История и `bestPlaces` своей
  статистики пропускают гонки, которых `RaceRegistry.get` не вернул (черновик или неизвестная). Числа могут не
  совпасть со списком.
- **why_it_matters:** «Гонки: 3» при двух строках истории. Редкий случай (гонка с протоколом, ставшая недоступной).
- **evidence:** `bestPlace: summary.bestPlaces[0]?.place` без проверки гонки.
- **recommended_fix:** считать сводку по строкам, гонки которых существуют, или принять и описать в `profile.md`.

### [LOW] Тесты не доказывают, что GPS был во входе
- **file:** apps/api/src/modules/profile/avatar-image.test.ts, apps/api/src/modules/profile/profile-avatar.int.test.ts
- **location:** avatar-image.test.ts:74–76; profile-avatar.int.test.ts:90–91
- **problem:** вход проверяется только на `orientation === 6` и `exif` defined, выход — на отсутствие строки
  `PokatimTest`. Что во входе действительно есть GPS IFD (`withExif` + `withMetadata`), не проверено.
- **why_it_matters:** AC1 «EXIF (GPS…)» держится на допущении о поведении `withExif` в 0.35.
- **evidence:** нет ассерта по GPS во входе.
- **recommended_fix:** во входе проверить наличие GPS (например, байты `GPSLatitudeRef`/тег 0x8825 в `before.exif`),
  в выходе — `exif` undefined (уже есть).

### [LOW] `failOn: 'error'` мягче дефолта sharp
- **file:** apps/api/src/modules/profile/avatar-image.ts
- **location:** :83
- **problem:** уровни sharp по строгости: `none < truncated < error < warning` (дефолт). `error` пропускает файлы с
  предупреждениями libvips. Это осознанный выбор §7 (телефонные JPEG с предупреждениями), но в ADR-0018 он описан как
  ужесточение.
- **why_it_matters:** формулировка в R-5/R-A4 вводит в заблуждение. Поверхность libvips — та же.
- **evidence:** документация sharp `failOn`.
- **recommended_fix:** в ADR-0018 написать, что `error` — ослабление относительно дефолта ради совместимости.

### [LOW] Сортировка истории райдов не покрыта индексом целиком
- **file:** apps/api/src/modules/rides/rides.repository.ts
- **location:** :483–508 (`pastOf`)
- **problem:** `rides_participant_idx` — `{ 'participants.userId': 1, startsAt: 1 }`. Сортировка
  `{ startsAt: -1, _id: -1 }` требует SORT-стадии в памяти по всем прошедшим райдам пользователя (multikey, ключ `_id`
  вне индекса).
- **why_it_matters:** сейчас райдов на пользователя десятки — дёшево. Пометка на будущее, §3 PR A «дешёвый расчёт».
- **evidence:** `0014_rides.ts:16`.
- **recommended_fix:** принять (как сейчас) или при росте — индекс `{ 'participants.userId': 1, startsAt: -1, _id: -1 }`.

### Без находок по измерениям

- **Сигнатуры и формат:** белый список по магии плюс `metadata().format` = сигнатуре; GIF и текст — 415, не
  octet-stream — 415.
- **Метаданные:** EXIF, ICC и XMP стёрты (проверено unit-тестом).
- **Обрезка:** клэмп к рамке и `<64` — 422 корректны.
- **Пределы sharp:** `timeout` 10 с, `cache(false)`, лимит пикселей проверяется вручную до декода.
- **Отдача `/v1/avatars/:id`:** заголовки ставятся после чтения, на 404 нет `immutable`, `nosniff` и `CSP sandbox`
  есть.
- **Приватность профиля:** согласие и имя — в фильтре `findPublic`, ключи ответа держит тест, `userId` не выходит,
  404 после отзыва, очистки имени, сброса модератором и удаления.
- **Удаление аккаунта:** `deleteAllOf` до профиля. Поздний PUT воскрешает данные, их убирает sweep — принятая гонка,
  описана.
- **Место в истории:** через `entryResult`, второго расчёта нет.
- **Миграция:** expand-only, идемпотентна, бэкфиллы условны.
- **Границы модулей:** только порты через `index.ts`, цикла `profile ↔ results` нет.
- **Контракты:** аддитивны, `.default(null)`, `tolerantEnum`, коды в конце `ErrorCode`.
- **Транзакции:** транзакции профиля без `lockUser` соответствуют исключению в `pokatim-db.md`.

## PR A, исправления (проход 1)

| Находка | Статус | Что сделано |
|---|---|---|
| HIGH-1 курсор публичной истории со `startedAt` | исправлено | Курсор `GET /v1/riders/:publicId/races` — `{ k: 'r', id: raceId }`; позиция ищется в отсортированном в памяти списке (`pageRows`), гонки нет в истории — 400. Int-тест: декодированный курсор = `{ k: 'r', id }`, без даты/времени и без `startedAt` строк; чужой id — 400. `/v1/profile/races` (курсор — `raceWindowStartsAt` гонки + id своей заявки) и `/v1/profile/rides` (`startsAt` райда + id) — только публичное время гонки/райда и свои id, времени заездов нет — без изменений. |
| MEDIUM-1 память sharp | исправлено | `avatarSlots.maxTotal = 1`, `AVATAR_MAX_INPUT_PIXELS = 25 000 000`. Замер `mem.cjs` (macOS arm64): 40 Мп — одна +136…141 МБ, две +281…286 МБ; 25 Мп — одна +93 МБ. Shrink-on-load не применён (точность обрезки), запись — ADR-0018. Пик RSS в образе `linux/amd64` — NOT VERIFIED (шаг `pr.md`). Тест: второй пользователь при занятом слоте — 429. |
| MEDIUM-2 медленная отправка держит слот | исправлено | `PROFILE_POLICY.avatarBodyTimeouts` — тишина 10 с, всё тело 60 с; int-тест 408 + `Connection: close`, слот свободен. |
| LOW-1 квота при «слот занят» | исправлено | `admit`: слот первым, затем лимит (отказ лимита освобождает слот). Int-тест: 5 отказов по слоту не тратят квоту (1 + 19 → 200, 21-я — 429). |
| LOW-2 статистика vs история | принято | Сводка — по всем строкам опубликованных протоколов; расхождение только для гонки, ставшей черновиком. Отмечено в `profile.md` (риски). |
| LOW-3 GPS во входе | исправлено | `hasGpsIfd` (тег 0x8825 в EXIF входа) — unit и int; int — ещё и производитель во входе. |
| LOW-4 `failOn` в ADR | исправлено | ADR-0018: `error` — ослабление относительно дефолта `warning`, ради JPEG телефонов. |
| LOW-5 индекс истории райдов | принято | Райдов на пользователя — десятки; индекс `{ 'participants.userId': 1, startsAt: -1, _id: -1 }` — при росте. |
