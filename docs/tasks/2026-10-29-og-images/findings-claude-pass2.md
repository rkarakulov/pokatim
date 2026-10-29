# Findings — og-images — pass 2 — reviewer: claude
base: origin/develop (develop @ 95c4b24a)   commits: ac01c4a3..39e78d71 (фиксы — 3adb0c14; весь diff перечитан)
verdict: APPROVE (CRITICAL/HIGH нет)

Проверено самостоятельно:
- unit api (`og-card.{inputs,texts,render,png}`, `sharing.policy`, `story-card.processor`, `og-sync.processor`,
  `changed-since`) — 8 файлов / 35 тестов зелёные, PNG 19–38 КБ;
- int api `og-card.int.test.ts` + `og-sync.int.test.ts` на изолированных Mongo :27117 (`pokatim_ogrev2_test`) и
  Redis :6479/13 — 2 файла / 23 теста зелёные (включая новые F1/F2/F3/F5);
- app jest (`og-image`, `public-metadata`, `route-metadata`) — 3 набора / 51 тест зелёные;
- `git merge-tree HEAD origin/develop` — без конфликтов (F4 закрыт).
- Полный `pnpm check` — NOT VERIFIED (не запускался).

Статус находок pass 1:
- **F1 (HIGH) — закрыт.** `STORE_READY` (og-card.cache.ts:27–34) атомарен: GET прежнего хэша, SET PNG с TTL,
  SET `og:obj:<kind>:<id>` (EX 7 сут.), DEL `og:pending:<hash>`, DEL `og:png:<old>` только при `old ~= hash`. Ключи:
  KEYS[1] obj, KEYS[2] png, KEYS[3] pending; ARGV[5] = `og:png:` — удаляется ровно PNG прежнего хэша этого объекта.
  Повтор того же хэша PNG не удаляет (тест). Выдача продлевает и `og:obj` (og-card.cache.ts:51–57). Ключ `og:png:<old>`
  собирается внутри скрипта, а не передаётся в KEYS — для standalone Redis (наш деплой) корректно, в Cluster было бы
  нарушением; не finding. Гонка двух рендеров разных версий — см. LOW-1 (самолечится, при одном worker с
  `concurrency: 1` не воспроизводится). Утечка ограничена одним «лишним» PNG на объект до его TTL.
- **F2 (MEDIUM) — закрыт частично**, см. MEDIUM-1.
- **F3 (MEDIUM) — закрыт.** `OgSync.prerender` ловит ошибку строки, курсор вида идёт дальше (og-sync.ts:106–120);
  сбой `changed`/`cursor`/`setCursor` — по-прежнему откат вида. Планировщик и boot — `attempts: 1,
  removeOnComplete: true, removeOnFail: true`; тип `JobSchedulerTemplateOptions` bullmq допускает эти поля
  (`Omit<JobsOptions, 'jobId'|'repeat'|'delay'|'deduplication'>`), `upsertJobScheduler` обновляет шаблон.
- **F4 (LOW) — закрыт.** **F5 (LOW) — закрыт** (версия HTTP = версия фактов без линии, и ≠ версии с линией).

Свежий взгляд на весь diff (без новых замечаний): приватность D7 (`ogFacts` только публичных объектов, `routeId`
райда — только каталог), анонимные эндпоинты (zod-параметры, `302` только на путь из провалидированных kind/id,
`no-store` у заглушки и 404, IP-лимиты своими бакетами), рендер только в worker, SSR (`og:image` только от
`WEB_ORIGIN`, `notFound` — без картинки в `pageOgImage`/`brandOgImageFor`, версия параллельно с данными страницы,
бренд лениво), смена бренд-разметки сопровождена `renderVersion` 1 → 2, OutcomeSink сторис/приглашений не изменён
по контракту.

### [MEDIUM] Короткий TTL самолечения обходится вторым запросом: выдача продлевает любой PNG до 7 суток
- **file:** apps/api/src/modules/sharing/og-card.cache.ts
- **location:** `png()` стр. 51–57; вызов — og-card.service.ts:59 (`serve`)
- **problem:** worker пишет PNG объекта вне окна пререндера с `pngShortTtlSec` (1 сут.), но первая же выдача 200 делает
  `GETEX … EX pngTtlSec` (7 сут.) независимо от того, «живой» ли объект. Сценарий: анонимный клиент перебирает id
  публичных объектов (история райдов, прошедшие гонки, календарь) и запрашивает каждый `/v1/og/images/...` дважды —
  1-й запрос: заглушка + постановка рендера; через ~1 с 2-й запрос: 200 и TTL 7 сут. Итог по памяти — как до фикса F2
  (число публичных объектов × ~35 КБ на 7 суток при `noeviction`). Защищает только от одноразового обхода.
- **why_it_matters:** ровно сценарий pass-1 F2 (OOM Redis → падают очереди, лимиты, сессии), обходится тривиально;
  IP-лимит 300/мин пулом IP не ограничивает. Объёмы dev пока малы — поэтому MEDIUM, не HIGH. Комментарий политики
  («выдача продлевает до `pngTtlSec`») поведение описывает, но расчёт памяти в Outcome его не учитывает.
- **evidence:** `this.redis.getexBuffer(pngKey(target.hash), 'EX', ttl)` при `const ttl = OG_CARD_POLICY.pngTtlSec`;
  `sharing.policy.ts`: `pngShortTtlSec: 86_400 /* выдача продлевает до pngTtlSec */`; int-тест F2 проверяет TTL только
  до первой выдачи.
- **recommended_fix:** продлевать тем же правилом, что пишет worker: `OgCardService.serve` считает
  `ogPrerenderable(resolved.input, clock.now())` (CLOCK уже есть в модуле) и передаёт `ttlSec` в `cache.png(...)`
  (`pngTtlSec` или `pngShortTtlSec`; бренд — `pngTtlSec`); int-тест: «старый» объект → рендер → выдача 200 → TTL ≤
  `pngShortTtlSec`.

### [LOW] Запоздавший рендер старой версии перетирает `og:obj` и удаляет PNG текущей версии
- **file:** apps/api/src/modules/sharing/og-card.cache.ts
- **location:** `STORE_READY` стр. 28–32; `StoryCardProcessor.buildOgCard` (story-card.processor.ts:185–197)
- **problem:** скрипт безусловно ставит `og:obj` на хэш задачи. Если задача A (хэш hA) сверила хэш до правки объекта,
  а записала после того, как задача B (hB, новая версия) уже записала свой PNG, то A: `old = hB ≠ hA` → удаляет
  `og:png:hB`, `og:obj` → hA (устаревшая версия, недостижима по URL, живёт до TTL).
- **why_it_matters:** нужно ≥2 процесса worker (или перекрытие старого и нового контейнера при выкате): в
  `infra/deploy/docker-compose.yml` один worker с `concurrency: 1`, там A и B строго последовательны и B удалит hA —
  поэтому LOW. Последствие самолечится: `og:pending:hB` снят скриптом B, следующая выдача hB ставит рендер заново
  (временно — бренд-заглушка; `og.sync` объект не перепроверит — курсор уже прошёл).
- **evidence:** `redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])` без условия; хэш сверяется только до рендера
  (`if (!resolved || resolved.hash !== job.hash) return null;`).
- **recommended_fix:** по желанию: перед `storeReady` перечитать хэш объекта (`ogInputs.resolve`) и при расхождении —
  `skipped` (сужает окно до миллисекунд), либо зафиксировать допущение «один worker» в комментарии `STORE_READY`.

### [LOW] Транзиентный сбой чтения в `prerender` теперь сдвигает курсор мимо строк
- **file:** apps/api/src/modules/sharing/og-sync.ts
- **location:** стр. 81–84, 106–120
- **problem:** catch строки не различает «ядовитую» строку и временный сбой (Mongo-блип в `inputs.resolve`, ошибка
  `queue.add`): при сбое на всех строках пачки курсор всё равно встаёт на последнюю, и до 200 объектов вида выпадают из
  пререндера до следующей правки (догонит только самолечение по запросу).
- **why_it_matters:** деградация первого шаринга (бренд вместо карточки) после короткого сбоя; памяти и корректности
  не касается. Это компромисс рекомендации pass 1, отмечаю как известное.
- **evidence:** `if (await this.prerender(kind, row.id, now)) enqueued += 1; last = { at: row.updatedAt, id: row.id };`
  — `last` двигается и при `prerender` → `false` по исключению.
- **recommended_fix:** по желанию: если упали все строки пачки (или ≥ N подряд) — не двигать курсор и пометить вид в
  `failedKinds`.
