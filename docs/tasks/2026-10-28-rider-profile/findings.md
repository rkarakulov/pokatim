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
  ADR-0019. Обязательно проверить пик RSS в образе `linux/amd64` (шаг в `pr.md`).

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
  принятый риск в ADR-0019.

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
  предупреждениями libvips. Это осознанный выбор §7 (телефонные JPEG с предупреждениями), но в ADR-0019 он описан как
  ужесточение.
- **why_it_matters:** формулировка в R-5/R-A4 вводит в заблуждение. Поверхность libvips — та же.
- **evidence:** документация sharp `failOn`.
- **recommended_fix:** в ADR-0019 написать, что `error` — ослабление относительно дефолта ради совместимости.

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
| MEDIUM-1 память sharp | исправлено | `avatarSlots.maxTotal = 1`, `AVATAR_MAX_INPUT_PIXELS = 25 000 000`. Замер `mem.cjs` (macOS arm64): 40 Мп — одна +136…141 МБ, две +281…286 МБ; 25 Мп — одна +93 МБ. Shrink-on-load не применён (точность обрезки), запись — ADR-0019. Пик RSS в образе `linux/amd64` — NOT VERIFIED (шаг `pr.md`). Тест: второй пользователь при занятом слоте — 429. |
| MEDIUM-2 медленная отправка держит слот | исправлено | `PROFILE_POLICY.avatarBodyTimeouts` — тишина 10 с, всё тело 60 с; int-тест 408 + `Connection: close`, слот свободен. |
| LOW-1 квота при «слот занят» | исправлено | `admit`: слот первым, затем лимит (отказ лимита освобождает слот). Int-тест: 5 отказов по слоту не тратят квоту (1 + 19 → 200, 21-я — 429). |
| LOW-2 статистика vs история | принято | Сводка — по всем строкам опубликованных протоколов; расхождение только для гонки, ставшей черновиком. Отмечено в `profile.md` (риски). |
| LOW-3 GPS во входе | исправлено | `hasGpsIfd` (тег 0x8825 в EXIF входа) — unit и int; int — ещё и производитель во входе. |
| LOW-4 `failOn` в ADR | исправлено | ADR-0019: `error` — ослабление относительно дефолта `warning`, ради JPEG телефонов. |
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
| LOW-4 `failOn` | закрыта | ADR-0019 исправлен. |
| LOW-5 индекс райдов | принято | Согласен. |

### [MEDIUM] (A) 25 Мп на сервере противоречит плану PR B «исходник уходит как есть» — web отклонит фото 48/50 Мп
- **file:** docs/adr/0019-rider-avatars.md, packages/contracts/src/profile/rider-avatar.schema.ts
- **location:** ADR-0019 §1 «кадры 48 Мп клиент уменьшает при обрезке (PR B)»; `rider-avatar.schema.ts:9–13`
  (комментарий «системная обрезка native и web-экран обрезки дают меньше»)
- **problem:** допущение ADR не подкреплено планом: `docs/tasks/2026-10-28-rider-profile/plan-b.md:313` — «не
  перекодируем на клиенте (canvas). Исходник уходит как есть», web-экран обрезки шлёт **исходный файл** + доли.
  Кадр 48–50 Мп (режим полного разрешения Android-флагманов, iPhone ProRAW/48MP JPEG) → `422 AVATAR_INVALID`.
  Системная обрезка Android (`expo-image-picker`, `allowsEditing`) отдаёт обрезанный квадрат в исходном разрешении:
  у 50 Мп сенсора 6120² ≈ 37 Мп → тоже 422. Утверждение «дают меньше» не проверено.
- **why_it_matters:** AC14 PR B (понятные тексты 422 есть), но пользователь современного телефона не сможет поставить
  фото без ручного уменьшения — функциональный провал, а не ошибка ввода. PR A не ломается, но ADR фиксирует ложное
  допущение, на которое опирается выбор 25 Мп.
- **evidence:** `plan-b.md:313`; ADR-0019 §1; `AVATAR_MAX_INPUT_PIXELS = 25_000_000`.
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
  выросла. ADR-0019 «медленная отправка держит слот не дольше 60 с» мульти-аккаунтный сценарий не упоминает.
- **why_it_matters:** злоупотребление (§8.3): отказ функции фото для всех на процессе. Не блокер (функция не критична,
  данные не страдают), но риск надо принять осознанно.
- **evidence:** код политики; расчёт выше. Буферизует ли тело прокси (Caddy) перед API — NOT VERIFIED (если да,
  атака не доходит до слота).
- **recommended_fix:** любое из: IP-лимит приёма аватара (как `consumeIpLimit`) в `admit`; слот берётся **после**
  чтения тела (тело ≤ 10 МиБ буферизуется в памяти без слота, слот — только на `processAvatar`, где и нужна память) —
  это убирает и медленную отправку как вектор; либо записать принятый риск в ADR-0019 «Последствия».

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
| MEDIUM-A 48–50 Мп отклоняются | исправлено | Конвейер в две стадии: `autoOrient` + `resize` до 2048 px (`fit: inside`, без увеличения) в raw — JPEG/WebP с shrink-on-load; затем `extract` по `scaleRect` + 512 JPEG. Пределы: `AVATAR_MAX_INPUT_PIXELS = 100 Мп` (JPEG/WebP), новый `AVATAR_MAX_PNG_PIXELS = 25 Мп` (у PNG нет shrink-on-load). Замер (macOS arm64): JPEG 48 Мп +39 МБ, JPEG 100 Мп +40 МБ, WebP 48/100 Мп +39 МБ, PNG 25 Мп +106…109 МБ (на 4096 px: JPEG 48 Мп +104…109, WebP +183 — поэтому 2048). Тесты: unit и int — 48 Мп JPEG с orientation 6 принимается, обрезка по долям верна (цвет пикселей); PNG > 25 Мп — 422. Цифры — ADR-0019; комментарий контракта и `plan-b.md` (клиент не уменьшает) обновлены. |
| MEDIUM-B один слот на процесс | исправлено | Слоты разделены: чтение тела — `UploadSlots` 4 на процесс и 1 на пользователя; обработка — `AvatarProcessingGate` 1 на процесс, ожидание до 5 с, затем `429 retryAfterSec: 5`. Тесты: unit семафора (ожидание, таймаут, идемпотентный `release`); int — медленное тело одного не блокирует другого; занятая обработка — 429, освободилась — 200. ADR-0019 «Последствия». |
| LOW курсор при выпадении строки | принято | Поведение 400 оставлено; в `plan-b.md` — сброс к первой странице без баннера. |
| LOW числа в task.md | исправлено | §3, §7, RC-A1, AC2, §11 и матрица тестов — 100/25 Мп, слоты 4/1 + обработка 1; итог — §8.2. |

Изоляция тестов: Redis db 9 параллельно использовала другая сессия (случайные 429 в тестах лимитов профиля) —
прогоны прохода 2 на `pokatim_riderprofileb_test` и Redis db 13.

## PR B, проход 1

# Findings — rider-profile (PR B) — pass 1 — reviewer: claude
base: feature/rider-profile (ef494df)   commits: a32ba38..f77ea08 (ветка feature/rider-profile-app, рабочее дерево чистое)
verdict: APPROVE

Проверено самостоятельно: `pnpm --filter @pokatim/app typecheck` — зелёный; jest по затронутым наборам (own-profile,
rider-profile, profile-screen, home, public-metadata, features/profile/*, rider-avatar, top-bar, public-ssr,
not-found, auth-guard, theme-guards) — 18 наборов, 186 тестов, зелёные. `playwright` без API (сборка `dist` ветки,
`EXPO_PUBLIC_API_URL=http://127.0.0.1:3000`, порт 8190): новые шаги «неизвестный райдер» и «`/profile` без сессии» и
шаг A12 — зелёные; 05b и 05c — красные (разбор ниже).

### [MEDIUM] Web-обрезка: файл, который браузер не смог декодировать, — тупик без сообщения
- **file:** apps/app/src/features/profile/avatar-crop.web.tsx
- **location:** `<img … onLoad=…>` (стр. 181–187), `ready`/«Сохранить фото» (стр. 88, 206–213)
- **problem:** у `<img>` нет `onError`. Если файл прошёл пре-чек по `file.type`, но не декодируется (битый файл,
  HEIC/AVIF с подписью `image/jpeg`, обрезанная загрузка из облака), `onLoad` не наступит: окно пустое,
  «Сохранить фото» и масштаб навсегда выключены, текста ошибки нет. Помогает только «Отмена».
- **why_it_matters:** AC14 («ошибки — понятные тексты») и §4.12 (ошибка с действием, а не немое состояние). Сервер
  на такой файл ответил бы 422 с понятным текстом, но клиент до него не доходит.
- **evidence:** `grep -c onError avatar-crop.web.tsx` → 0. В `avatar-crop.web.test.tsx` нет сценария ошибки
  загрузки картинки.
- **recommended_fix:** `onError` на `<img>` → колбэк вроде `onTooSmall` (например `onUnreadable`). Редактор закрывает
  панель и показывает `profile.avatar.error.AVATAR_INVALID`. Добавить тест: `fireEvent.error(img)` → баннер.

### [LOW] Публичный профиль после отзыва согласия продолжает показывать имя и фото из кэша вкладки
- **file:** apps/app/src/features/riders/rider-screen.tsx
- **location:** `notFound` (стр. 88–89)
- **problem:** «Профиль недоступен» показывается только при `rider.data === undefined`. Если данные уже были (посев
  SSR или первый ответ), а refetch (фокус после 60 с, pull-to-refresh, инвалидация `['riders']`) вернул 404, на
  экране остаются имя, клуб и фото с баннером «Данные могли устареть».
- **why_it_matters:** 404 здесь означает «райдер скрыл профиль», а не сбой обновления. Отзыв согласия (R-3) не
  скрывает данные в открытой вкладке зрителя, пока её не перезагрузят. Это шире 60 с серверного кэша (R-4), хотя и
  ограничено памятью вкладки.
- **evidence:** `const notFound = !valid || (rider.data === undefined && apiErrorOf(rider.error)?.code === 'NOT_FOUND');`
- **recommended_fix:** считать `NOT_FOUND` в `rider.error` «недоступен» при любом `data` (или на 404 вызывать
  `removeQueries(riderKey(id))`). Добавить тест: данные → refetch 404 → «Профиль недоступен».

### [LOW] 429 с короткой паузой всегда считается «обработка занята», в том числе для удаления и почти истёкшего лимита
- **file:** apps/app/src/features/profile/avatar-errors.ts
- **location:** `BUSY_MAX_RETRY_SEC`, стр. 35–36
- **problem:** «Фото сейчас обрабатываются…» выбирается только по `retryAfterSec <= 60`. Часовой лимит 20/ч, у
  которого до сброса < 60 с, и 429 удаления (`profile-update`, 30/ч, `DeleteAvatar` тоже вызывает
  `avatarErrorMessage`) дадут тот же текст про обработку.
- **why_it_matters:** неверная причина в тексте. Вреда нет, повтор через минуту всё равно сработает.
- **evidence:** `profile-avatar.service.ts`: занятость — `limited(5)`, квоты — `limited(result.retryAfterSec)`;
  `avatar-section.tsx:48` — `onError: (error) => onFailure(avatarErrorMessage(error))`.
- **recommended_fix:** для удаления — `actionErrorMessage`/текст лимита. Для загрузки — «занято» только при
  `retryAfterSec <= 5` (константа сервера), либо отдельный код/деталь в ответе (follow-up контракта).

### [LOW] Ошибка истории без сети: заголовок «Нет соединения» с текстом «Сервис временно недоступен»
- **file:** apps/app/src/features/profile/profile-history.tsx; apps/app/src/features/riders/rider-screen.tsx
- **location:** `failure={t('state.failedMessage')}` (profile-history.tsx стр. 51, 74; rider-screen.tsx стр. 50)
- **problem:** `TabFailure` сам выбирает заголовок (сеть → «Нет соединения»), а текст берёт из `message`. Сюда передан
  серверный текст из базы, поэтому офлайн баннер противоречит сам себе. Остальные вызовы `TabFailure` передают
  нейтральный текст блока («Не удалось загрузить результаты»).
- **why_it_matters:** §4.12 — понятный текст ошибки, разный для сети и сервера.
- **evidence:** `results-table.tsx:145–151`; `@rkarakulov/i18n-core` `state.failedMessage` = «Сервис временно
  недоступен. Попробуйте ещё раз.»
- **recommended_fix:** ключ блока, например `profile.history.failed` «Не удалось загрузить историю», как у
  `races.results.failed`.

### [LOW] Окно обрезки: `aria-describedby` повторяет `aria-label` — скринридер читает одну фразу дважды
- **file:** apps/app/src/features/profile/avatar-crop.web.tsx
- **location:** стр. 155–156 и 189–191
- **problem:** у метки и описания один ключ `profile.avatar.crop.area` («Область фото. Стрелки — сдвиг, плюс и
  минус — масштаб»).
- **why_it_matters:** a11y web-кропа (AC14): лишний повтор при каждом фокусе.
- **recommended_fix:** `aria-label` — «Область фото», описание (видимая подсказка) — про клавиши (два ключа).

### [LOW] A11y строки гонки без места: «место —»
- **file:** apps/app/src/features/profile/profile-format.ts
- **location:** `placeText` (стр. 34–35), `raceA11y` (стр. 94)
- **problem:** без места `a11y` = `profile.stats.none` («—»), и строка читается как «…, место —, …».
- **recommended_fix:** без места не добавлять часть «место …» в метку (или отдельный ключ «без места»).

### [LOW] (вне зоны PR B) e2e 05b/05c падают без API — давний дефект, к PR B не относится
- **file:** apps/app/e2e/web.spec.ts (стр. 375–411); apps/app/src/app/rides/route-pick.tsx;
  apps/app/src/features/rides/ride-report*
- **problem:** воспроизведено (см. шапку). 05c: на странице только `progressbar "Загрузка"`. `route-pick.tsx`
  рисует `<ShellSkeleton />` без `failure`, поэтому заголовка ошибки не будет никогда. 05b: экран
  `RideReportScreen` открыт (status `unavailable` — гард его пропускает) и показывает свою ошибку запроса «Не
  удалось загрузить», а не «Нет соединения».
- **why_it_matters / связь с PR B:** не связано. В diff PR B нет ни одного файла на этих путях: `rides/*`,
  `features/rides/*`, `features/auth/*`, `features/onboarding/*`, `shell-skeleton.tsx`, `AsyncContent`. `_layout.tsx`
  меняется только двумя `Stack.Screen`, `public-ssr.ts` — необязательным параметром `publicPath` (вызовы по
  умолчанию те же, тест зелёный). Ветка «без API» этих шагов в CI не исполняется: `ci.yml` задаёт `E2E_API: '1'`.
  Поэтому дефект латентный с 62c7b0d (05c PR B). Аналогичный новый шаг `/profile` без сессии (`useSettingsShell` →
  `ShellSkeleton failure=…`) зелёный.
- **recommended_fix:** отдельной задачей зоны райдов: `route-pick.tsx` и `rides/report/[id].tsx` — через
  `useSettingsShell()` (или `ShellSkeleton failure={useShellFailure()}`); либо поправить ожидание шага. В PR B — не
  трогать.

### NOT VERIFIED
- `E2E_API=1` (шаг «имя/клуб через API → гость на `/riders/<publicId>`» и ветки WITH_API новых шагов) не запускался
  ни мной, ни кодером. Проверит CI, merge — только на зелёном.
- iOS/Android вживую: системная обрезка 1:1, `fetch(file://).blob()` → `PUT` с `octet-stream` через fetch RN (XHR RN
  с Blob, заголовок задан явно), старый dev-клиент без `ExponentImagePicker` («Обновите приложение» покрыто только
  jest), HEIC → JPEG при `allowsEditing`.
- Совпадение `naturalWidth/Height` браузера с ориентацией `autoOrient` сервера для EXIF 5–8 — по спецификации
  `image-orientation: from-image` по умолчанию; живого замера нет.

### Без находок по измерениям
- **Placement / reuse:** соответствует plan-b §1–2. `public-ssr.ts` расширен, не продублирован. `StatBlock`,
  `SegmentedControl`, `AsyncContent`, `TabFailure`/`RowsSkeleton`, `placeView`, `resultPill`, `DetailHeader`,
  `DocumentTitle`, `OfflineBanner` переиспользованы. DTO не копируются, свой `fetch` в экранах только для `file://`
  на native (как у треков).
- **Все платформы:** развилки только файлами (`pick-avatar(.web)`, `avatar-editor(.web)`, `avatar-crop.web`).
  `Platform.OS`, `Alert`, `onEndReached` нет. `expo-image-picker` загружается лениво после
  `requireOptionalNativeModule`, в web-бандл не попадает.
- **SSR / публичный экран:** `loader` — посев и `null`; `generateMetadata` всегда нейтральная, `noindex`, без
  `og:url` и ПДн (unit + e2e); `DocumentTitle` нейтральный; `publicPath` проверяет `RiderPublicId` до запроса;
  невалидный id — без запроса; «Гонки» запрашиваются только после найденного профиля.
- **Приватность:** публичный экран показывает только поля `PublicRiderProfile` (без км, райдов, `userId`). Ссылка
  «Как вас видят другие» — только при `publicId !== null`.
- **Ключи и инвалидации:** как в `pokatim-app.md`. `useOwnAvatarId` использует тот же кэш `['profile']` и
  `staleTime: Infinity` (тест «без второго запроса»). Мутации фото — `setQueryData` + `['riders']`, `PATCH` — плюс
  `['races','results']`. Свои запросы — через `withAccessToken`, публичные — без него.
- **Состояния §4.12:** шапка, статистика, сезон и история — скелетоны, ошибки с повтором, пусто с действием, баннер
  устаревших данных, «Показать ещё» с блокировкой во время запроса и баннером ошибки догрузки. 400 курсора публичной
  истории → `resetQueries` (тест).
- **Дизайн-система:** hex и px-литералов в стилях нет. Новый токен `layout.avatarProfile` — с тестом в
  `design-tokens`. Продуктовый `RiderAvatar` обоснован, follow-up в app-foundation записан.
- **Формы:** клуб — схема `RiderClub` из contracts, ошибки по коду с `RIDER_CLUB_MIN`.
- **i18n:** все строки в `packages/i18n`, формальное «вы».
- **Тесты:** честные, по AC 12–16 (навигация TopBar → `/profile`, вкладки и «Показать ещё», ссылки строк,
  413/415/422/429, удаление с подтверждением, web-кроп клавишами и кнопками, мета `/riders`). e2e-шаги
  `/riders/[id]` и `/profile` добавлены, `NOT_FOUND_PATHS` перенесён на `/no-such-page`.
- **Documentation Sync:** `pokatim-app.md` (раздел «Профиль райдера», `publicPath`), `docs/product/profile.md`,
  `docs/product/home.md`, отчёт PR B в task.md.
- **Контракты / сервер / миграции / очереди / аудит:** PR B их не меняет. Клиент шлёт только файл и доли обрезки,
  места и суммы приходят с сервера.

Итог: CRITICAL/HIGH нет → **APPROVE**. MEDIUM (немой отказ декодирования в web-кропе) желательно закрыть до merge.

## PR B, проход 2

# Findings — rider-profile (PR B) — pass 2 — reviewer: claude
base: origin/develop (aa857ba, входит в HEAD)   commits: a32ba38..44e7e83 (фиксы 3b8dcad, f77ea08; мержи 0ca8ee3, 5e0ed2d, 23cbb9e, 44e7e83)
verdict: APPROVE

Проверено самостоятельно на HEAD 44e7e83: `pnpm install --frozen-lockfile` — «Already up to date» (lockfile согласован с
`apps/app/package.json`); `pnpm format:check`, `pnpm arch:check` (depcruise, 0 нарушений), `eslint` по затронутым
путям, `typecheck` `@pokatim/app` и `@pokatim/i18n` — зелёные; jest `apps/app` целиком — 201 набор, 1834 теста,
зелёные; vitest `@pokatim/i18n` (14) и `@pokatim/design-tokens` (578) — зелёные. Маркеров конфликта в дереве нет.
`HEAD..origin/develop` пуст. Плагин `expo-image-picker@58.0.10` прочитан из опубликованного пакета (`npm pack`).

### Статус находок прохода 1
| Находка | Статус | Где |
|---|---|---|
| MEDIUM web-кроп: недекодируемый файл — тупик без сообщения | **fixed** | `avatar-crop.web.tsx:189` `onError={onUnreadable}`; `avatar-editor.web.tsx:39–42` — панель закрыта, текст `AVATAR_INVALID`; `picked-avatar.ts` — причина `AVATAR_INVALID`. Тесты: `avatar-crop.web.test.tsx` («не декодируется — onUnreadable, сохранить нельзя»), `avatar-editor.web.test.tsx` (текст, без запроса). |
| LOW публичный профиль после 404 показывает данные из кэша | **fixed** | `rider-screen.tsx:81, 89` — `NOT_FOUND` в `rider.error` → «Профиль недоступен» при любом `data`, «Гонки» выключены, `OfflineBanner` без данных. Тест в `rider-profile.test.tsx` (данные → pull-to-refresh 404 → имя и клуб исчезли). |
| LOW 429 «обработка занята» для удаления и почти истёкшего лимита | **fixed** | `avatar-errors.ts:16, 36–38` — порог 5 с (константа сервера `limited(5)`), удаление → `actionErrorMessage`; `avatar-section.tsx:48` передаёт `'delete'`. Тесты: 40 с → текст лимита, удаление → общий текст. |
| LOW «Нет соединения» + «Сервис временно недоступен» в истории | **fixed** | `profile-history.tsx:51, 74` — `profile.history.failed`; `rider-screen.tsx:50` — `riders.racesFailed`. Тест в `own-profile.test.tsx` (офлайн → «Нет соединения» + «Не удалось загрузить историю»). |
| LOW `aria-describedby` повторяет `aria-label` | **fixed** | `avatar-crop.web.tsx:158, 194`; ключи `profile.avatar.crop.area` / `.keys` в `ru.ts`; тест сверяет текст описания. |
| LOW a11y «место —» | **fixed** | `profile-format.ts:35, 90–94`; тест в `profile-format.test.ts`. |
| LOW (вне зоны) e2e 05b/05c без API | **open, accepted** | `apps/app/src/app/rides/route-pick.tsx:16` по-прежнему `<ShellSkeleton />` без `failure`; к PR B не относится, в CI ветка без API не исполняется. Нужна отдельная задача зоны райдов. |

### Мержи (route-rides, story cards, develop) — без находок
- `_layout.tsx`: `profile` — в группе экранов под гардом (рядом с `settings/*`), `riders/[id]` — в публичной группе
  рядом с `rides/[id]`. Экраны develop (`rides/route-pick`, `rides/report/[id]` и др.) на месте.
- `app-routes.ts`: `profile` и `riders/[id]` добавлены, маршруты develop не потеряны; полный jest зелёный.
- `ru.ts`: новые ключи `profile.*` / `riders.*` без дублей (tsc на объекте-литерале упал бы); ключи develop целы.
- `e2e/web.spec.ts` / `project.ts`: `UNKNOWN_RIDER_ID` в импортах и в `expectedResourceErrors`; `NOT_FOUND_PATHS`
  без `/profile`; шаг «с API» использует существующие `registerHomeRider`/`HOME_FIXTURE_PASSWORD`.
- `pnpm-lock.yaml`: добавлены только `expo-image-picker@58.0.10` и транзитивный `expo-image-loader@58.0.3`.
- `app.json`: плагин `expo-image-picker` добавлен после `expo-notifications`, остальные плагины не тронуты.

### [LOW] iOS: `cameraPermission: false` при коде камеры в бинарнике — риск ITMS-90683 при выгрузке в App Store
- **file:** apps/app/app.json
- **location:** стр. 57–64 (плагин `expo-image-picker`)
- **problem:** `false` убирает `NSCameraUsageDescription` и `NSMicrophoneUsageDescription` из Info.plist — это то, что
  нужно по продукту (камера и микрофон не используются). Но нативный модуль всё равно содержит вызовы камеры
  (`ios/ImagePickerPermissionRequesters.swift:13` — `AVCaptureDevice.requestAccess(for: .video)`, `launchCameraAsync`).
  Статический анализ App Store Connect для таких бинарников может прислать ITMS-90683 «Missing purpose string»
  (исторически — предупреждение, иногда отказ выгрузки).
- **why_it_matters:** сборка для стора может не пройти выгрузку или потребовать срочной правки конфигурации. На
  dev-клиент и Android не влияет.
- **evidence:** код плагина `plugin/build/withImagePicker.js` (`createPermissionsPlugin` с `false` → ключа нет);
  исходники iOS пакета 58.0.10.
- **recommended_fix:** код не менять. Добавить шаг в `pr.md`/чек-лист первой выгрузки в TestFlight: проверить письмо
  App Store Connect. Если придёт ITMS-90683 — задать нейтральную строку камеры (код камеру не вызывает, системный
  запрос не появится) и зафиксировать это в ADR-0019.

### [LOW] Android: в манифесте остаются READ/WRITE_EXTERNAL_STORAGE (API ≤ 32) из пакета
- **file:** apps/app/app.json
- **location:** стр. 57–64; манифест пакета `expo-image-picker/android/src/main/AndroidManifest.xml`
- **problem:** камера и микрофон закрыты правильно: `cameraPermission: false` → `withBlockedPermissions(CAMERA)`
  (`tools:node="remove"`), `microphonePermission: false` → `RECORD_AUDIO` не добавляется и заблокирован. (README
  пакета утверждает, что `false` камеру на Android не убирает, но код плагина 58.0.10 её блокирует.) Однако манифест
  пакета приносит `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` с `maxSdkVersion="32"`. Выбор через Photo Picker /
  `ACTION_OPEN_DOCUMENT` (`pick-avatar.ts` не запрашивает разрешений) их не требует.
- **why_it_matters:** лишние разрешения на Android 12 и ниже (карточка магазина, Data safety). Приватность пользователя
  не нарушена: системный запрос не показывается, пока код его не вызывает.
- **evidence:** манифест пакета 58.0.10; в `app.json` нет `android.blockedPermissions`.
- **recommended_fix:** по желанию — `"android": { "blockedPermissions": ["android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE"] }`, после проверки на устройстве с Android ≤ 12, что галерея
  открывается. Если это делать не стоит (другим пакетам могут понадобиться разрешения), записать в ADR-0019 как
  принятое.

### NOT VERIFIED
- `E2E_API=1` и playwright в этом проходе не запускались — проверит CI (merge только на зелёном).
- Сгенерированные Info.plist и AndroidManifest (`expo prebuild`) не собирались. Вывод о разрешениях — по коду плагина
  и манифесту пакета.
- iOS/Android вживую — как в проходе 1.
- Ложный `onError` при повторном эффекте в StrictMode (ревок первого blob-URL): по спецификации HTML смена `src`
  отменяет прежний запрос без события `error`. Живого замера в dev-режиме не было.

### Без находок по измерениям (дельта прохода 2)
- **Correctness фиксов:** `found`/`notFound` в `rider-screen.tsx` согласованы. После 404 успешный повтор очищает
  `error` и профиль возвращается. `onUnreadable` срабатывает только до `ready`: «Сохранить» недоступна, запроса нет.
- **Тесты:** новые сценарии честные, без тавтологий (проверяют текст на экране и отсутствие запроса/данных).
- **i18n / a11y / дизайн-система:** новые строки — в `packages/i18n`, формальное «вы». Литералов цвета и размера нет.
- **Контракты / сервер / миграции / очереди / аудит:** фиксы и мержи их не меняют.
- **Documentation Sync:** `pokatim-app.md` и task.md обновлены в 3b8dcad. Две LOW выше — в ADR-0019/`pr.md`.

Итог: MEDIUM и 5 LOW прохода 1 закрыты, LOW вне зоны принят. Новые находки — 2 LOW (нативные разрешения),
CRITICAL/HIGH/MEDIUM нет → **APPROVE**.
