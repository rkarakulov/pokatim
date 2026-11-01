# Findings — sitemap-index — pass 2 — reviewer: claude
base: origin/develop (merge-base)   commits: 3649ed58..HEAD (04025b2d + merge 416d071e)
verdict: APPROVE

Тесты не запускал (по указанию). e2e — NOT VERIFIED.

## Статус замечаний pass 1

- Claude HIGH и Codex HIGH (карты вне области URL) — **закрыто**. Дочерние карты теперь
  `/sitemap.xml?kind=static` и `/sitemap.xml?kind=<вид>&page=<n>` на том же маршруте в корне. Каталог
  `src/app/sitemap/**` удалён, `&` в `loc` экранируется (`xml()`). `parseSitemapQuery` отвергает лишние, повторные и
  неверные параметры без запроса к API. Остатков старых путей в app, e2e, rules и docs нет; task.md (§3, §8.2, AC1/AC2)
  синхронизирован.
- Claude MEDIUM (`lastmod` при сдвиге границ) — **закрыто**. Если состав страницы (`after`, `last`, `count`) отличается
  от прошлого поколения, `lastmod` равен моменту сборки индекса, иначе — прежнему значению или максимуму строк. Есть
  тесты на публикацию старого объекта и на снятие.
- Codex MEDIUM (мемо страниц пережило поколение индекса) — **закрыто**. Страницы живут в `Generation.pages` и
  истекают вместе с ним; есть тест на позднее первое чтение страницы со вставкой внутри неизменных границ.
- Claude LOW-1 (последняя страница вытесняла свои строки) — **закрыто**: сначала читается `(after, last]` с потолком
  `fileUrlMax`, затем строки `> last`, пока страница не больше `pageSize`.
- Claude LOW-2 (чтение за `last`) — **закрыто**: `IdRange.until` → `$lte`, тот же индекс.
- Claude LOW-3 (тест плана на копии запроса) — **закрыто**: `sitemap-indexes.int.test.ts` снимает `explain` с
  настоящего `sitemapCursor` репозиториев.
- Claude LOW-4 (полный проход при истёкшем мемо, таймаут SSR) — открыт как follow-up §12. Это не блокер.

Новый diff проверен: `read()` с двумя `collect`, `idWithin`, `lastmodOf`, `current()`/`build()`, вытеснение в
`Generation.pages`, маршрут `sitemap.xml+api.ts`. Миграция `0051` по-прежнему последняя, merge develop не принёс
номер `0052`. Ошибок корректности не нашёл.

### [LOW] `lastmod` при смене состава хранится только в памяти процесса
- **file:** apps/api/src/modules/sharing/sitemap.service.ts
- **location:** `previous` / `build()` / `lastmodOf` (первое поколение: `if (!known) return page.maxAt`)
- **problem:** Прошлое поколение известно только текущему процессу. После рестарта (каждый деплой) первое поколение
  берёт `maxAt`. Если до рестарта страница объявлялась с `lastmod` = момент сборки, её `lastmod` откатится назад.
  Если реплик API несколько, у каждой своё `previous`, и `lastmod` одной страницы скачет между ответами.
- **why_it_matters:** Мелкая неточность `lastmod`, потерь URL нет. Поведение описано в комментарии сервиса.
- **evidence:** `private previous: Bounds | null = null;` и `forget()` сбрасывает его.
- **recommended_fix:** По желанию — хранить подпись состава и `lastmod` страниц в MongoDB (одна маленькая запись на
  вид) или явно записать ограничение в §8.1.

### [LOW] Любой посторонний query у `/sitemap.xml` — 404 вместо индекса
- **file:** apps/app/src/lib/seo.ts
- **location:** `parseSitemapQuery` (ключи не пусты и не `kind`/`page` → `null`)
- **problem:** `/sitemap.xml?utm_source=x` и `?v=2` (cache-busting в инструментах SEO и в ручной отправке) теперь
  дают `404`, хотя до изменения отдавали карту.
- **why_it_matters:** Краулеры приходят без query по `robots.txt`, так что на практике это почти не проявляется.
- **evidence:** `if (keys.length === 0) return { type: 'index' }; … return null` для прочих ключей.
- **recommended_fix:** По желанию — без `kind` отдавать индекс при любых посторонних ключах, а строгий разбор
  оставить только при наличии `kind`.
