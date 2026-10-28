# Findings — story-cards — pass 2 — reviewer: claude
base: origin/develop   commits: acbfbd4..5ce02a5 (4 коммита; рабочее дерево чистое)
verdict: APPROVE

Проверено запуском:
- `apps/api`: `vitest --project unit sharing` — 4 файла, 27 тестов, зелёные; `vitest --project integration story-card`
  (Mongo `…pokatim_storycards_review_test`, Redis db 2) — 14 тестов, зелёные.
- `apps/app`: `jest src/__tests__/story-card.test.tsx src/lib/share-story src/__tests__/race-results` — 4 сьюта,
  25 тестов, зелёные.
- `pnpm --filter @pokatim/app typecheck`, `pnpm --filter @pokatim/api typecheck` — без ошибок.
- Полный `pnpm check` не запускался (у автора в task.md — EXIT 0, 191/1739 app, 141/1548 api).

## Закрытие находок pass 1 (claude + codex)

| Находка pass 1 | Фикс (5ce02a5) | Тест | Статус |
|---|---|---|---|
| HIGH своя строка без группы (оба) | `ownRowAction: (group) => () => router.push(rivalPath(…, group))`; таблица передаёт `group` вкладки | `story-card.test.tsx` «своя заявка в w_u40 при группе сервера m_u40»: путь `?group=w_u40`, кнопка есть, «Результат не найден» нет | закрыта |
| HIGH ошибка обновления прячет карточку (оба) | `ready = query.data?.status === 'ready' ? …` без `!isError`; `isPending: !isError && ready === undefined` | «ready → ошибка обновления: превью остаётся, баннер с повтором» (сетевые ретраи прокручены фейковыми таймерами) | закрыта |
| MEDIUM/HIGH нет повтора PNG (оба) | `FileFailure` — баннер («Нет соединения» / «Не удалось загрузить») + `TextAction` «Повторить» → `file.refetch()` | «PNG не скачался — баннер с «Повторить»; повтор готовит файл и включает «Поделиться»» | закрыта |
| MEDIUM финишёр без «Предварительный» (codex) | `StoryCardFacts.provisional = protocolPublishedAt === null`, метка по нему, поле в хэше, `renderVersion` 2 | unit (метка до/после публикации, хэш), int (`finisher` до публикации — `provisional: true`; после — `false`) | закрыта |
| MEDIUM причина провала рендера (claude) | `warn` с `error.name: error.message` | int: лог `failed (Error: boom)` | закрыта |
| LOW ретраи 4xx | `retryable` на `shouldRetry` проекта | косвенно (существующие 409/429 тесты экрана) | закрыта |
| LOW группа после публикации из заявки | группа из строки протокола (`row.groupKey ?? 'overall'`) | int: группа заявки изменена, на карточке группа строки | закрыта |
| LOW `revokeObjectURL` синхронно | `setTimeout(…, 1000)` | web-тест на фейковых таймерах | закрыта |
| LOW имя файла `…png.png` | `.png` снимается до очистки | native-тест имени | закрыта |
| NOT VERIFIED эмодзи | — | unit-рендер с эмодзи и CJK — не падает | проверено автором |

Проверка фиксов на регрессии:
- `provisional` после публикации: в `protocolResult` статус `provisional` недостижим (строка — `final|revised|dq`, без
  строки — `ignoreBest`), так что смена условия метки с `status === 'provisional'` на `protocolPublishedAt === null` не
  убирает «Предварительный» ни у одного прежнего случая; старые картинки инвалидированы `renderVersion` 2.
- Сохранение `ready` при ошибке: 409 по-прежнему ведёт на «Карточки пока нет» (`unavailable` проверяется до
  `AsyncContent`); `pending`/`failed` нового хэша приходят после успешного ответа `pending`, который заменяет `data`, —
  старая готовая карточка остаётся только при сетевой ошибке, 5xx или 429 (своему пользователю, ссылка ещё жива). Комментарий в
  `queries.ts` («ошибки «не готова» и 409 бывают только когда новый ответ — не `ready`») неточен (при броске из
  `queryFn` TanStack сохраняет прежние `data`), но на поведение экрана это не влияет.
- `ownRowAction` для вкладки по умолчанию даёт `group === undefined` — путь без `?group`, как раньше.

Повторный просмотр всего diff на CRITICAL/HIGH (серверный авторитет, приватность линии, AuthN/лимиты, капабилити-токен,
идемпотентность очереди, границы модулей, контракты, §4.11–4.13, Documentation Sync) — новых CRITICAL/HIGH нет; выводы
pass 1 по этим измерениям подтверждаются на `5ce02a5`.

### [MEDIUM] Своя строка финишёра (START / Verified без пульса) не ведёт на «Ваш результат»
- **file:** apps/app/src/features/races/results-table.tsx
- **location:** `FinisherRowView` (88–118), вкладка `finishers` (≈300–305); `disputes/dispute-screen.tsx` `findRow`
- **problem:** `storyCardEligible` включает статус `finisher`, т. е. у финишёра без места `canShareStory = true`, но его
  строка есть только во вкладке «Финишёры», а `FinisherRowView` не принимает `onPress`. `ownRowAction` туда не
  передаётся. И даже если бы передавался, `RivalCardScreen` ищет строку только в `useRaceResults` (`findRow`), то есть
  финишёр получил бы «Результат не найден».
- **why_it_matters:** вход 2 (R8, AC1 «на экране своей строки таблицы») для финишёров не работает. Вход 1 («Ваше
  участие») у них есть, поэтому поделиться карточкой они могут; сломан только второй путь. Блокером не считаю.
- **evidence:** `<FinisherRowView key={row.entryId} row={row} own={row.entryId === ownEntryId} />` — без `onPress`;
  `STORY_CARD_STATUSES` содержит `'finisher'`; `RivalCardScreen` → `findRow(data, entryId)` по страницам
  `useRaceResults`.
- **recommended_fix:** либо сделать свою строку финишёра нажимаемой и научить экран результата брать строку из
  `useRaceFinishers` (`?tab=finishers`), либо явно вывести финишёров из входа 2 в task.md §8.2 / pr.md (вход 1 у них
  есть).

### [LOW] Повтор подготовки PNG без индикации загрузки
- **file:** apps/app/src/features/races/story/story-card-screen.tsx
- **location:** `ShareAction` / `FileFailure`
- **problem:** пока идёт `file.refetch()` после ошибки, TanStack держит `isError === true` до успеха. Поэтому баннер и
  «Повторить» остаются на экране, кнопка «Поделиться» выключена и без `loading`, а на `TextAction` нет признака
  занятости. Повторные нажатия запускают новые попытки скачивания.
- **recommended_fix:** во время `file.isFetching` показывать `loading` на «Поделиться» (`loading={busy || !story && (!fileFailed || file.isFetching)}`) или отключать «Повторить».

### [LOW] Сообщение ошибки рендера в логе worker не фильтруется
- **file:** apps/api/src/modules/sharing/story-card.processor.ts
- **location:** `build`, ветка `catch` (`reason`)
- **problem:** комментарий утверждает, что «входы и ПДн в сообщения рендера не попадают», но это не гарантировано:
  `error.message` от satori, resvg или порта `results` может содержать фрагменты разметки, например название гонки или
  имя. Имя попадает на карточку только с согласием и публично, поэтому риск низкий.
- **recommended_fix:** обрезать `message` (например, до 200 символов) и/или логировать только `error.name` плюс код
  известных ошибок (`PNG_TOO_LARGE`, шрифт).

## NOT VERIFIED
- `docker build --target api` и загрузка `@resvg/resvg-js` в образе amd64.
- Шаринг на iOS/Android (новая dev-сборка), Web Share в мобильных Safari/Chrome, Instagram в листе Android.
- Визуальная сверка PNG с прототипом (AC8: PNG трёх тем — у автора в scratchpad, не в git).
- Полный `pnpm check` (только узкие тесты и typecheck app/api).
