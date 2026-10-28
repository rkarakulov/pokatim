# Findings — story-cards — pass 1 — reviewer: claude
base: origin/develop   commits: acbfbd4..d2f4fe3 (3 коммита; рабочее дерево чистое)
verdict: REQUEST CHANGES

Проверено запуском:
- `apps/api`: `vitest --project unit sharing` — 4 файла, 24 теста, зелёные; `vitest --project integration story-card`
  (Mongo `…pokatim_storycards_review_test`, Redis db 2) — 12 тестов, зелёные. Примечание: БД без суффикса `_test`
  (`pokatim_storycards_review`) роняет globalSetup (`recreateTestMongoDatabase`) с нечитаемой ошибкой vitest.
- `apps/app`: `jest src/__tests__/story-card.test.tsx src/lib/share-story` — 3 сьюта, 13 тестов, зелёные.
- Полный `pnpm check` не запускался.

Чисто по измерениям (без находок): серверный авторитет (предикат `storyCardEligible` один для `actions` и 409,
место/время — `entryResult`), приватность линии (`sliceLine` по `trackMap.segment`, проверки `counted`, `userId`,
`linePoints`; фолбэк — публичная линия маршрута; int-тест на подъезде), имя только через `RIDER_NAMES`, логи worker
без `userId`/имени/токена, токен 128 бит + regex до Redis, заголовки PNG, IP-лимит, идемпотентность (NX-ключ +
`jobId`, сверка хэша → `skipped`, `failed` через `GETDEL`), границы модулей (только `index.ts`, циклов нет, пакеты
без циклов: `i18n → contracts`, `route-view → …`), контракты (`canShareStory.default(false)`, новый код ошибки в
конце, новые схемы), миграций нет, ленивый `expo-sharing` + фолбэк `downloadFile`, развилка `.web.ts`, web-share
без `await` до `navigator.share`, рефакторинг форматтеров/геометрии/начертаний — поведение сохранено (у
`formatElapsed` панели добавился `Math.max(0, trunc)` — безопасно), Documentation Sync (ADR-0018, индекс, продукт,
оба runbook, 4 правила зон).

### [HIGH] Своя строка в группе не по умолчанию ведёт на «Результат не найден»
- **file:** apps/app/src/features/races/race-detail.tsx
- **location:** 183–187 (`ownRowAction`)
- **problem:** своя строка открывает `rivalPath(race.id, ownEntryId)` без `group`. Таблица по умолчанию показывает
  вкладку **своей** группы (`fallback` в `results-table.tsx` 236–240: `ownGroup` первым) и, если она не равна группе
  ответа сервера по умолчанию (`defaultGroup` = первая непустая по `RESULT_GROUP_KEYS`: `overall`, `m_u40`, …),
  грузит её отдельным запросом с `group`. `RivalCardScreen` без `group` берёт таблицу группы по умолчанию
  (`useRaceResults(raceId, valid, undefined)`), `findRow` не находит свою заявку → `DisputeNotFound`
  «Результат не найден», кнопки «Поделиться в сторис» нет.
- **why_it_matters:** вход 2 (R8, AC1 «на экране своей строки таблицы») сломан для всех райдеров не в первой
  непустой группе — в гонке со схемой `gender_age`, где есть `m_u40`, это все женщины и мужчины 40+. Чужие строки
  этой ошибки не имеют: `rowAction` передаёт `group`. Архитектор в §11 прямо задавал
  `rivalPath(race.id, ownEntryId, group)`.
- **evidence:** `ownRowAction={… ? () => router.push(rivalPath(race.id, entry.data!.entry!.id)) : null}` vs
  `rowAction={(entryId, group) => … router.push(rivalPath(race.id, entryId, group))}`; `results-table.tsx`
  `onPress={own ? ownRowAction : (rowAction?.(row.entryId, group) ?? null)}` — `group` вкладки в `ownRowAction` не
  передаётся. Тест `story-card.test.tsx:101` проверяет только путь без группы (`/races/result/${RACE_ID}/${ENTRY_ID}`).
- **recommended_fix:** сделать `ownRowAction` функцией от группы вкладки (`(group) => (() => void) | null`, как
  `rowAction`) и передавать `group` в `rivalPath`; тест: своя заявка в `w_u40` при группе по умолчанию `m_u40` —
  экран «Ваш результат» с кнопкой.

### [HIGH] Ошибка обновления прячет готовую карточку (AGENTS.md §4.12)
- **file:** apps/app/src/features/races/story/queries.ts
- **location:** `useStoryCard`, строка `const ready = !query.isError && query.data?.status === 'ready' …` и
  `isPending: !query.isError && …`
- **problem:** при любой ошибке повторного запроса (сеть, 5xx, 429) превью и кнопка «Поделиться» заменяются полным
  состоянием ошибки, хотя TanStack сохранил прежний `ready`. На web повторный запрос происходит на возврате фокуса
  вкладки (`visibilitychange`, `staleTime` 10 с) — в том числе после закрытия листа `navigator.share`.
- **why_it_matters:** §4.12: «ошибка обновления при уже показанных данных — данные остаются, сверху баннер с
  повтором»; контракт ревью относит нарушения §4.12 к HIGH. Ошибки `StoryCardNotReady` возникают только когда новый
  ответ — `pending`/`failed` (тогда `data` уже не `ready`), а 409 обрабатывается отдельно (`unavailable`) — так что
  прятать `ready` при ошибке не нужно ни в одном случае.
- **evidence:** `queries.ts`: `const ready = !query.isError && query.data?.status === 'ready' ? query.data : undefined;`
  `state: { data: ready, error: query.error, isPending: !query.isError && ready === undefined, isError: … }`.
- **recommended_fix:** отдавать `data: query.data?.status === 'ready' ? query.data : undefined` независимо от
  `isError` (AsyncContent при данных + ошибке показывает баннер с повтором); тест: `ready` → refetch с сетевой
  ошибкой → превью на месте + баннер.

### [MEDIUM] Сбой подготовки PNG — баннер без повтора, кнопка заблокирована навсегда
- **file:** apps/app/src/features/races/story/story-card-screen.tsx
- **location:** `ShareAction`/`ReadyCard` (`<ShareAction file={file.data} error={file.isError} />`)
- **problem:** если `useStoryFile` (native `File.downloadFileAsync`, web `fetch`) упал, показывается баннер
  «Не удалось поделиться карточкой», кнопка `disabled={!file}`; повтора нет (ни `refetch`, ни действия в баннере).
  Выйти из тупика можно только уходом с экрана.
- **why_it_matters:** §4.12 «ошибки с повтором»; на мобильной сети это обычный сценарий.
- **recommended_fix:** при `file.isError` — кнопка/действие баннера «Повторить» → `file.refetch()`; тест.

### [MEDIUM] Финальный провал рендера теряет причину
- **file:** apps/api/src/modules/sharing/story-card.processor.ts
- **location:** `build`, ветка `catch` при `finalAttempt`
- **problem:** на последней попытке исключение проглатывается, задача завершается успешно (`'failed'`), в лог
  пишется только `entry … failed in N ms` — без класса/сообщения ошибки. В failed-набор BullMQ задача не попадает.
- **why_it_matters:** `pokatim-backend.md`: финальный провал — видимое состояние; пользователю он виден (`failed`),
  но эксплуатации диагностировать нечем (шрифт не найден, PNG > 2 МБ, сбой resvg — неразличимы).
- **recommended_fix:** логировать `error.name`/`error.message` (сообщения satori/resvg/`fontFilePath` не содержат
  ПДн) в той же строке `warn`.

### [LOW] Ретраи статуса карточки повторяют 4xx
- **file:** apps/app/src/features/races/story/queries.ts
- **location:** `retryable`
- **problem:** повторяются все ошибки, кроме `StoryCardNotReady` и 409, — включая 429, 400, 401; общий
  `shouldRetry` проекта 4xx не повторяет. На 429 это два лишних запроса в уже исчерпанный лимит.
- **recommended_fix:** `retryable = (count, error) => !(error instanceof StoryCardNotReady) && shouldRetry(count, error)`.

### [LOW] Группа на карточке после публикации — из заявки, место — из строки протокола
- **file:** apps/api/src/modules/results/results-for-sharing.ts
- **location:** `storyCardFacts`, `group: entry.groupKey ?? 'overall'`
- **problem:** после публикации место берётся из `row` (его группа — `row.groupKey`), подпись группы — из заявки. При
  расхождении (смена группы после снимка) карточка покажет место одной группы с подписью другой. «Моё участие»
  поступает так же, поэтому только LOW.
- **recommended_fix:** при наличии строки протокола брать `row.groupKey ?? 'overall'` (строка уже читается рядом).

### [LOW] Web «Скачать PNG»: `revokeObjectURL` сразу после `click()`
- **file:** apps/app/src/lib/share-story.web.ts
- **location:** `shareStory`, ветка `download`
- **problem:** отзыв blob-URL синхронно после `link.click()` в части браузеров (исторически Safari/Firefox) обрывает
  скачивание.
- **recommended_fix:** `setTimeout(() => URL.revokeObjectURL(href), 0…1000)`.

### [LOW] Имя файла в кэше native — `story-<token>png.png`
- **file:** apps/app/src/lib/share-story.ts
- **location:** `fileName`
- **problem:** `replace(/[^A-Za-z0-9_-]/g, '')` убирает точку из `<token>.png`. Косметика (имя видно в листе
  «Сохранить в Файлы»).
- **recommended_fix:** срезать `.png` до очистки.

## NOT VERIFIED
- `docker build --target api` и загрузка `@resvg/resvg-js` в образе amd64 (автор тоже не проверял).
- Шаринг на iOS/Android (новая dev-сборка), Web Share в мобильных Safari/Chrome, Instagram в листе Android.
- Рендер глифов вне шрифтов тем (эмодзи в названии гонки) — satori без `loadAdditionalAsset`; поведение не проверял.
- Полный `pnpm check`.
