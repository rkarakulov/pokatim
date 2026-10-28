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

## PR A, проход 2

# Findings — rider-profile (PR A) — pass 2 — reviewer: claude
base: origin/develop   commits: fba643c..ed5ba05 (8d376c8, 19ee539, ed5ba05) + итоговый origin/develop...HEAD по затронутым местам
verdict: APPROVE

Проверено: unit `avatar-image.test.ts`, `riders.policy.test.ts` (16/16), contracts `src/profile` (48/48) — локально
зелёные. Int-тесты (`profile-avatar.int.test.ts`, `riders.int.test.ts`) прочитаны, мной не запускались (NOT VERIFIED —
Mongo стенда недоступна ревьюеру).

### Статус находок прохода 1

| Находка | Статус | Комментарий ревьюера |
|---|---|---|
| HIGH-1 курсор со `startedAt` | **закрыта** | Курсор `{ k: 'r', id: raceId }` (`riders.service.ts`, `RaceCursorKey = z.literal('r')`), `pageRows` ищет позицию по `raceId` (одна строка на гонку в текущих ревизиях). Чужой id — 400. Int-тест декодирует курсор и проверяет отсутствие даты/`startedAt`. Курсоры `/v1/profile/races` (окно гонки) и `/v1/profile/rides` (начало райда) — публичное время и свои данные, утечки нет. |
| MEDIUM-1 память sharp | **закрыта** | 25 Мп и `maxTotal: 1`: по замеру ≈ +93 МБ на обработку — запас под 512m есть. Пик в `linux/amd64` — шаг `pr.md` (остаётся NOT VERIFIED). Но см. MEDIUM-A ниже — следствие для PR B. |
| MEDIUM-2 медленная отправка | **частично** | Таймауты 10/60 с — улучшение, но слот теперь один — см. MEDIUM-B. |
| LOW-1 квота при «слот занят» | закрыта | Слот → лимит; отказ лимита освобождает слот (`try/catch` + `release`). Тест честный (1 + 19 → 200, 21-я — 429). |
| LOW-2 статистика vs история | принято | Записано в `profile.md`. Согласен. |
| LOW-3 GPS во входе | закрыта | `hasGpsIfd` (тег 0x8825) во входе — unit и int. |
| LOW-4 `failOn` | закрыта | ADR-0018 исправлен. |
| LOW-5 индекс райдов | принято | Согласен. |

### [MEDIUM] (A) 25 Мп на сервере противоречит плану PR B «исходник уходит как есть» — web отклонит фото 48/50 Мп
- **file:** docs/adr/0018-rider-avatars.md, packages/contracts/src/profile/rider-avatar.schema.ts
- **location:** ADR-0018 §1 «кадры 48 Мп клиент уменьшает при обрезке (PR B)»; `rider-avatar.schema.ts:9–13`
  (комментарий «системная обрезка native и web-экран обрезки дают меньше»)
- **problem:** допущение ADR не подкреплено планом: `docs/tasks/2026-10-28-rider-profile/plan-b.md:313` — «не
  перекодируем на клиенте (canvas). Исходник уходит как есть», web-экран обрезки шлёт **исходный файл** + доли.
  Кадр 48–50 Мп (режим полного разрешения Android-флагманов, iPhone ProRAW/48MP JPEG) → `422 AVATAR_INVALID`.
  Системная обрезка Android (`expo-image-picker`, `allowsEditing`) отдаёт обрезанный квадрат в исходном разрешении:
  у 50 Мп сенсора 6120² ≈ 37 Мп → тоже 422. Утверждение «дают меньше» не проверено.
- **why_it_matters:** AC14 PR B (понятные тексты 422 есть), но пользователь современного телефона не сможет поставить
  фото без ручного уменьшения — функциональный провал, а не ошибка ввода. PR A не ломается, но ADR фиксирует ложное
  допущение, на которое опирается выбор 25 Мп.
- **evidence:** `plan-b.md:313`; ADR-0018 §1; `AVATAR_MAX_INPUT_PIXELS = 25_000_000`.
- **recommended_fix:** до PR B решить явно: (a) PR B уменьшает на клиенте до ≤ 25 Мп (web — canvas/`createImageBitmap`
  с `resizeWidth`, native — `expo-image-manipulator`), доли обрезки пересчитываются от уменьшенного; метаданные всё
  равно стирает сервер; или (b) сервер — shrink-on-load для JPEG (`sharp(bytes, …).resize` с `fit: 'inside'` до
  размера ≥ 512 на сторону обрезки, затем `extract` в пересчитанных координатах — точность квадрата сохраняется с
  ошибкой ≤ 1 px исходника на масштаб). Исправить формулировку ADR и комментарий контракта, обновить plan-b.md.

### [MEDIUM] (B) Один слот на процесс: три аккаунта постоянно блокируют загрузку фото
- **file:** apps/api/src/modules/profile/profile.policy.ts
- **location:** :19–24 (`avatarSlots: { maxTotal: 1 }`, `avatarBodyTimeouts: { idleMs: 10_000, totalMs: 60_000 }`)
- **problem:** медленная отправка (байт раз в 9 с) держит единственный слот 60 с; 20 загрузок/ч × 60 с = 20 мин/ч на
  аккаунт → 3 аккаунта держат слот процесса непрерывно. В проходе 1 нужно было 2 аккаунта — цена атаки почти не
  выросла. ADR-0018 «медленная отправка держит слот не дольше 60 с» мульти-аккаунтный сценарий не упоминает.
- **why_it_matters:** злоупотребление (§8.3): отказ функции фото для всех на процессе. Не блокер (функция не критична,
  данные не страдают), но риск надо принять осознанно.
- **evidence:** код политики; расчёт выше. Буферизует ли тело прокси (Caddy) перед API — NOT VERIFIED (если да,
  атака не доходит до слота).
- **recommended_fix:** любое из: IP-лимит приёма аватара (как `consumeIpLimit`) в `admit`; слот берётся **после**
  чтения тела (тело ≤ 10 МиБ буферизуется в памяти без слота, слот — только на `processAvatar`, где и нужна память) —
  это убирает и медленную отправку как вектор; либо записать принятый риск в ADR-0018 «Последствия».

### [LOW] Курсор публичной истории — 400, если строка райдера выпала из новой ревизии между страницами
- **file:** apps/api/src/modules/riders/riders.policy.ts
- **location:** `pageRows`, `findIndex … if (at < 0) return null`
- **problem:** курсор держится на присутствии строки гонки; пересчёт протокола, выбросивший строку, превращает
  валидный курсор «Показать ещё» в `400 VALIDATION_FAILED`.
- **why_it_matters:** редкий случай; PR B должен на 400 курсора перезагрузить список, а не показывать ошибку.
- **evidence:** int-тест «чужой id — 400» подтверждает поведение.
- **recommended_fix:** принять и отметить в plan-b.md (обработка 400 курсора — сброс к первой странице), либо при
  отсутствии гонки — вернуть первую страницу/пусто.

### [LOW] Документы task.md §3/§7/§9 AC2/§11 по-прежнему говорят «40 Мп», «2 слота»
- **file:** docs/tasks/2026-10-28-rider-profile/task.md
- **location:** строки 43, 146, 173, 232, 483, 492–493, 557, 578
- **problem:** отклонение записано в §8.2, но AC2 и матрица тестов ссылаются на 40 Мп.
- **why_it_matters:** следующий проход/PR B читают AC буквально.
- **recommended_fix:** пометить в AC2 «(25 Мп — §8.2)» или обновить числа.

### Новых проблем в коде исправлений не найдено
`admit` корректно освобождает слот при 429 квоты; контроллер читает таймауты из политики на каждом запросе (тест
с `Object.assign` работает и восстанавливает значения в `finally`); `decodeCursor` с `z.literal('r')` отвергает
прежние курсоры с датой (400) — допустимо, клиента PR B ещё нет; контракты изменены только в константе (не
форма ответа). HIGH/CRITICAL нет → **APPROVE**; MEDIUM-A желательно решить до старта PR B.

## PR A, исправления (проход 2)

| Находка | Статус | Что сделано |
|---|---|---|
| MEDIUM-A 48–50 Мп отклоняются | исправлено | Конвейер в две стадии: `autoOrient` + `resize` до 2048 px (`fit: inside`, без увеличения) в raw — JPEG/WebP с shrink-on-load; затем `extract` по `scaleRect` + 512 JPEG. Пределы: `AVATAR_MAX_INPUT_PIXELS = 100 Мп` (JPEG/WebP), новый `AVATAR_MAX_PNG_PIXELS = 25 Мп` (у PNG нет shrink-on-load). Замер (macOS arm64): JPEG 48 Мп +39 МБ, JPEG 100 Мп +40 МБ, WebP 48/100 Мп +39 МБ, PNG 25 Мп +106…109 МБ (на 4096 px: JPEG 48 Мп +104…109, WebP +183 — поэтому 2048). Тесты: unit и int — 48 Мп JPEG с orientation 6 принимается, обрезка по долям верна (цвет пикселей); PNG > 25 Мп — 422. Цифры — ADR-0018; комментарий контракта и `plan-b.md` (клиент не уменьшает) обновлены. |
| MEDIUM-B один слот на процесс | исправлено | Слоты разделены: чтение тела — `UploadSlots` 4 на процесс и 1 на пользователя; обработка — `AvatarProcessingGate` 1 на процесс, ожидание до 5 с, затем `429 retryAfterSec: 5`. Тесты: unit семафора (ожидание, таймаут, идемпотентный `release`); int — медленное тело одного не блокирует другого; занятая обработка — 429, освободилась — 200. ADR-0018 «Последствия». |
| LOW курсор при выпадении строки | принято | Поведение 400 оставлено; в `plan-b.md` — сброс к первой странице без баннера. |
| LOW числа в task.md | исправлено | §3, §7, RC-A1, AC2, §11 и матрица тестов — 100/25 Мп, слоты 4/1 + обработка 1; итог — §8.2. |

Изоляция тестов: Redis db 9 параллельно использовала другая сессия (случайные 429 в тестах лимитов профиля) —
прогоны прохода 2 на `pokatim_riderprofileb_test` и Redis db 13.
