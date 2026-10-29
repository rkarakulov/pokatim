# Findings — og-images — pass 1 — reviewer: claude
base: origin/develop (merge-base 0ab5a08a)   commits: a734a94a..ac01c4a3
verdict: REQUEST CHANGES (1 HIGH: F1)

Проверено самостоятельно: unit api (`og-card.{inputs,texts,render,png}`, `sharing.policy`, `story-card.processor`,
`og-sync.processor`, `changed-since`) — 8 файлов / 35 тестов зелёные, PNG 22–38 КБ; app jest (`og-image`,
`public-metadata`, `route-metadata`) — 3 набора / 51 тест зелёные. Int-тесты (MongoDB/Redis) и полный `pnpm check` —
NOT VERIFIED (не запускались в этом проходе; полагаюсь на чтение тестов).

Измерения без замечаний: приватность (D7: `ogFacts` — `findPublished`/`findPublic+published`/`findInCatalog`;
`routeId` райда только при `visible(…, null)`; линия райда — `inviteLine` с перепроверкой каталога; организатора/автора
в типах фактов нет), рендер только в worker (сервис/контроллер не импортируют satori/resvg), валидация параметров
(enum/Uuid/`^[0-9a-f]{16}\.png$`), 302 — путь из провалидированных kind/id (открытого редиректа нет), заголовки
(public только у текущей версии, заглушка и 404 — `no-store`, nosniff/CSP), IP-лимиты своими бакетами, BullMQ
priority (задачи без priority берутся раньше) + NX + jobId, диспетчер процессора по имени (сторис/приглашение без
изменений), SSR (`WEB_ORIGIN`, параллельный запрос версии, бренд лениво, `notFound` — без `og:image`, `useId` нет),
миграция 0037 — только `createIndex`, последняя в списке, номер свободен в develop; Documentation Sync §10 выполнен.

### [HIGH] Неограниченный рост памяти Redis: PNG устаревших версий живут 7 суток, райдер плодит их правками
- **file:** apps/api/src/modules/sharing/og-card.cache.ts
- **location:** `storeReady` (стр. 60–66); в связке с `og-sync.ts:77–90` и `rides.policy.ts` `manageLimit`
- **problem:** каждый новый хэш объекта получает свой `og:png:<hash>` с TTL 7 сут. Предыдущий PNG того же объекта не
  удаляется: он недостижим (старая `v` → 302), но держит память до истечения TTL. `og.sync` пререндерит любой
  изменившийся «живой» райд в пределах минуты, поэтому каждая правка райда (название, место, темп, дистанция, время)
  = новый PNG ~35 КБ на 7 суток. Лимит правок райда — `rides-manage` 30/ч на пользователя.
- **why_it_matters:** один аккаунт: 30 × 24 × 7 ≈ 5 000 PNG × ~35 КБ ≈ 175 МБ в установившемся режиме — почти весь
  Redis dev (`maxmemory 192mb`, `noeviction`). OOM на запись ломает очереди BullMQ, лимиты и сессии всего API (ровно
  сценарий R-A1). Два аккаунта — гарантированный отказ. Оценка памяти в Outcome («≈ 50 КБ × живые + запрошенные»)
  правки не учитывает. Тот же эффект у легитимных частых правок, только медленнее.
- **evidence:** `storeReady`: `.set(pngKey(hash), png, 'EX', OG_CARD_POLICY.pngTtlSec)` — ни индекса «объект → хэш»,
  ни удаления прежнего; `OgSync.run`: `!hasPng(resolved.hash) && enqueue(...)` для каждой строки `ogChanged`;
  `RIDES_POLICY.manageLimit = { limit: 30, windowSec: 3600 }`; `pngTtlSec: 7 * 86_400`.
- **recommended_fix:** при `storeReady` вести ключ объекта `og:obj:<kind>:<id>` → текущий хэш (EX `pngTtlSec`) и в той
  же транзакции/Lua удалять `og:png:<прежний хэш>`, если он отличается (старый PNG по смыслу недостижим — удаление
  безопасно). Дополнительно (по желанию): короткий TTL пререндера (например, 1–2 сут.) с продлением до 7 сут. только
  при выдаче, и/или предохранитель в `OgCardQueue.enqueue` (не ставить рендер при `used_memory` выше порога). Int-тест:
  две правки райда + рендер → в Redis один `og:png:*` этого райда.

### [MEDIUM] Нет глобального потолка памяти OG при анонимном обходе публичных объектов
- **file:** apps/api/src/modules/sharing/og-card.service.ts
- **location:** `serve` (стр. 52–67), `OG_CARD_POLICY.imageIpLimit`
- **problem:** анонимный клиент перебирает id публичных объектов (ленты, история райдов, календарь, каталог) и для
  каждого запрашивает `/v1/og/images/...` — самолечение рендерит и хранит PNG 7 суток для всех, включая «неживые»
  (вне `ogPrerenderable`). Ограничение — только число публичных объектов и IP-лимит 300/мин (с пула IP — нет).
- **why_it_matters:** при росте числа прошедших райдов/стартов (тысячи × ~35 КБ) тот же OOM `noeviction` Redis, что и
  в F1; вариант A R-A1 ограничивает пререндер, но не самолечение. Сейчас объёмы dev малы — поэтому MEDIUM.
- **evidence:** `serve`: `if (png) …; await this.enqueue(kind, id, resolved.hash)` — без проверки окна/квоты;
  `storeReady` → `EX pngTtlSec` (7 сут.) для любой картинки.
- **recommended_fix:** для объектов вне `ogPrerenderable` писать PNG с коротким TTL (например, 1 сут., продление при
  выдаче) и/или общий предохранитель по `INFO memory`/счётчику `og:png` перед постановкой; зафиксировать в pr.md
  расчёт с самолечением.

### [MEDIUM] Одна «ядовитая» строка навсегда блокирует вид в `og.sync`, failed-набор растёт без предела
- **file:** apps/api/src/modules/sharing/og-sync.ts
- **location:** стр. 70–96 (try/catch на весь вид)
- **problem:** любое исключение на строке (resolve порта, `ogPrerenderable`, постановка) откатывает весь вид: курсор
  вида не двигается, следующий прогон упирается в ту же строку. Задача `og.sync` падает каждую минуту; у задач
  планировщика `removeOnFail: false` (умолчание `api-kit` `QueueModule`) и `attempts: 5` — failed-набор копит ~1 440
  задач со стеком в сутки.
- **why_it_matters:** пререндер вида останавливается навсегда (до ручной правки данных), а Redis (`noeviction`)
  медленно растёт; сигнал — только warn-лог без id строки.
- **evidence:** `catch (error) { failedKinds.push(kind); … }` без продвижения `last`; `OG_SCHEDULES.job = { name }` без
  `opts`; `node_modules/@rkarakulov/api-kit/dist/queue/queue.module.js`: `removeOnFail: false`, `attempts: 5`.
- **recommended_fix:** ловить ошибку на уровне строки (лог `og.sync_row_failed kind id`, строку пропустить, курсор
  двигать; транзиентные ошибки чтения курсора/`ogChanged` — по-прежнему откат вида), а планировщику передать
  `opts: { removeOnComplete: true, removeOnFail: 100, attempts: 1 }` (следующий прогон через минуту и так повторит).

### [LOW] Ветка не сливается с текущим develop без конфликта
- **file:** packages/i18n/src/ru.ts
- **location:** блок `ogCard.*`
- **problem:** `git merge-tree HEAD origin/develop` (develop @ ae86978e, PR #110 user-theme-app) — конфликт в `ru.ts`.
- **why_it_matters:** PR не смёрджится автоматически; при ручном разрешении легко потерять ключи `ogCard.*`.
- **evidence:** `CONFLICT (content): Merge conflict in packages/i18n/src/ru.ts`.
- **recommended_fix:** влить develop, разрешить конфликт, перепрогнать `TURBO_CONCURRENCY=1 pnpm check`.

### [LOW] Тест AC4 обещает «версия как без линии», но версию не сравнивает
- **file:** apps/api/src/modules/sharing/og-card.int.test.ts
- **location:** стр. 242–259
- **problem:** для райда с private-маршрутом проверяется только `ogFacts(...).routeId === null`; HTTP-версия с версией
  без линии не сопоставляется (поведение по сути покрыто `og-card.inputs.test.ts` и `rides-for-sharing.int.test.ts`).
- **why_it_matters:** название теста переоценивает покрытие; регрессия в `OgCardInputs.resolve` (например, `routeId`
  из документа, а не из фактов) этим тестом не поймается.
- **recommended_fix:** сравнить `version('ride', privateRide.id)` с `ogCardVersion(ogCardHash({ kind: 'ride', themeId,
  facts: { ...facts, routeId: null } }))` либо переименовать тест.

Открытые вопросы автора (не findings, но до мержа): подтверждение темы OG «Классика» (§8.2) и утверждение токенов
`ogCard` по превью (R-A8); AC6 на dev — после деплоя.
