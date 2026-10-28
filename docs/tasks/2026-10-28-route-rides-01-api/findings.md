# Findings — route-rides-01-api — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..HEAD (22b7095..2ff6923), working tree clean
verdict: APPROVE

Проверено по измерениям контракта: correctness (POST, чтения, политика, окно сверки, ревизии) · регрессии
(`routes`/`tracks` — только аддитивные `findRideable`, `ownActivityHeads`, `liveActivities`; `results`, движок,
`CORRIDOR_ENGINE_VERSION`, golden не тронуты) · безопасность (видимость маршрута `IN_CATALOG | ownRider` + `status:
'ready'` на всех пяти ручках и в worker через `matchGeometry`; `userId` в каждом фильтре чтения; ответы — явные поля,
без `userId`/`trackMap`/`engineVersion`/координат вне `/track`; линия сверки наружу не уходит; логи — только id и коды) ·
placement (только через `index.ts`; `routes`/`tracks` о `route-rides` не знают) · contracts-first (новый файл,
`tolerantEnum`, 3 кода в конец `defineErrorCodes` + сторож порядка) · серверный авторитет (время/вердикт/сравнение —
сервер; сегмент движка целочисленный, `Math.round` в `match.ts:323,333`) · аудит (не требуется) · миграция `0032`
(expand-only, идемпотентна, не при старте) · идемпотентность BullMQ (jobId = id события, `claim`/`record` по
`checkRevision`, `requeue` с условием в фильтре, поздние задачи — `skipped`) · ошибки (финальная попытка —
`failed: error`, `THREAD_FAILURES` как у гонок; дефолт очереди 5 попыток, exp backoff 5 с — сумма ≪ 15 мин зависания) ·
стирание аккаунта (шаг после `tracks`, идемпотентен; поздний `record` по стёртому заезду — no-op) · i18n (тексты
ошибок) · Documentation Sync §10 (все 6 документов в diff) · дизайн-система / состояния / платформы — UI вне PR.

Прогнано мной: `vitest` `route-rides.policy.test.ts` — 11/11; `packages/contracts` `route-rides` + `common.test.ts` —
14/14. NOT VERIFIED: int-тесты (`route-rides*.int.test.ts`, `account-erasure`, `migrations`, регресс `results`) и
`pnpm check` — требуют стенда Mongo/Redis, не запускались; опираюсь на чтение кода и тестов.

### [MEDIUM] Гейт видимости маршрута на `/track` и чужой `rideId` не покрыты тестами
- **file:** apps/api/src/modules/route-rides/route-rides.int.test.ts
- **location:** 145–172 (AC3 «404 везде»), 381–400 (AC7); read-сервис `route-rides-read.service.ts:116–121`
- **problem:** AC3 проверяет `GET :rideId` и `:rideId/track` со **случайным** `rideId = uuidv7()` — 404 получится и без
  проверки видимости маршрута (заезда просто нет). AC7 проверяет существующий заезд на невидимом маршруте только для
  списка и `GET :rideId`, но не для `/track`. Сценария «райдер B запрашивает `rideId` райдера A по тому же маршруту
  каталога» (detail и track) нет ни в одном тесте.
- **why_it_matters:** `/track` отдаёт координаты трека — самая чувствительная ручка. Если строку
  `await this.route(routeId, userId)` (`route-rides-read.service.ts:117`) удалить или `userId` выпадет из
  `findOwn`, ни один тест не покраснеет — регрессия IDOR/видимости пройдёт CI. Это ровно та точка, которую §8 и
  `pokatim-security.md` требуют проверять «на каждой ручке».
- **evidence:** `const rideId = uuidv7(); … await get(r.auth, ridesUrl(routeId, \`/${rideId}/track\`))` (AC3);
  в AC7 после снятия с публикации — только `ridesUrl(catalog)` и `ridesUrl(catalog, \`/${catalogRide.rideId}\`)`.
- **recommended_fix:** в AC7 после снятия маршрута/удаления своего маршрута добавить `GET …/${ride.rideId}/track` → 404;
  добавить кейс: второй райдер с реальным `rideId` первого на том же каталожном маршруте — `GET :rideId` и `/track` →
  404, и в списке/кандидатах второго нет чужих заездов.

### [LOW] Параллельный POST одной группы (путь `isDuplicateKey`) не протестирован
- **file:** apps/api/src/modules/route-rides/route-rides.service.ts
- **location:** 157–170
- **problem:** ветка «проиграл гонку вставки → перечитать и вернуть 200» не исполняется ни одним тестом (AC5
  последовательный). В транзакции конкурентная вставка сначала даёт WriteConflict (ретрай `run`), затем `11000` —
  поведение правдоподобно верное, но не доказано.
- **why_it_matters:** при ошибке в имени индекса/фильтре `findByActivity` второй клиент получит 500 вместо 200.
- **evidence:** `if (!isDuplicateKey(error, ROUTE_RIDES_UNIQUE_INDEX)) throw error;` — нет `Promise.all` POST в тестах.
- **recommended_fix:** int-кейс: два одновременных POST одной активности → оба 2xx, один заезд, одно событие outbox.

### [LOW] Мёртвый нескоупленный читатель `findById` и неиспользуемое `Visible.now`
- **file:** apps/api/src/modules/route-rides/route-rides.repository.ts; route-rides-read.service.ts
- **location:** repository.ts:73–75; read.service.ts:31–35, 168
- **problem:** `findById(id)` без `userId` нигде не вызывается (worker использует `claim`); `Visible.now` возвращается,
  но не читается.
- **why_it_matters:** единственный метод репозитория без `userId` в фильтре — соблазн использовать его в HTTP-пути
  (противоречит комментарию класса «каждое чтение — с `userId`»); лишний код.
- **evidence:** `grep findById` — только определение.
- **recommended_fix:** удалить `findById` и поле `now` из `Visible`.

### [LOW] Документация: сироты удаляются только при создании нового заезда, а не «при следующей проверке»
- **file:** docs/product/routes.md
- **location:** раздел «Заезд по маршруту», пункт про удалённый заезд
- **problem:** «данные заездов остаются до следующей проверки по этому маршруту (сироты удаляются)» — но
  `deleteOrphans` вызывается только в `create` (`route-rides.service.ts:159`); повторная проверка существующего
  (`existing`/`requeued`) сирот не чистит. В `pokatim-db.md` и task.md 8.2 сформулировано верно («следующего нового
  заезда»).
- **why_it_matters:** продуктовый документ обещает более раннее удаление ПДн-производных, чем делает код (RC-1).
- **evidence:** `service.ts:68–84` — ветка `existing` не трогает `orphans`.
- **recommended_fix:** «…до следующего **нового** заезда по этому маршруту…».

### [LOW] Удаление основной активности группы скрывает заезд, хотя дубль группы жив
- **file:** apps/api/src/modules/route-rides/route-rides-read.service.ts
- **location:** 165–167 (`heads.has(ride.activityId)`); `tracks.repository.ts:326–342` (перевыбор основной)
- **problem:** заезд привязан к `activityId` основной на момент POST. Если райдер удалит именно её (например, импорт
  Garmin), а дубль группы (загрузка) останется и станет основной, заезд становится сиротой: пропадает из истории,
  кандидат показывает `rideId: null`, следующий POST создаёт новый заезд с новой проверкой и удаляет старый.
- **why_it_matters:** для райдера «тот же заезд» пропал с результатом; поведение формально соответствует RC-1/RC-3
  («удалённая активность — не видна»), но в продуктовом документе этот случай не описан.
- **evidence:** `deleteUploadCascade` удаляет активность физически; `ownActivityHeads` её больше не вернёт.
- **recommended_fix:** в рамках PR — описать в `docs/product/routes.md`; при желании follow-up — переносить заезд на
  новую основную (или искать живого члена группы по `duplicatesOf`).
