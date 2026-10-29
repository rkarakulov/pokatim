# 1. Title

Ссылки на публичный профиль и аватары в таблицах; финиши START в статистике профиля (task2).

Follow-ups `docs/tasks/2026-10-28-rider-profile/pr.md`; RC-A3 вариант (b) — решение пользователя 2026-10-29.

# 2. Goal

- Строка райдера с публичным профилем (имя + согласие, P1/R3) в таблице результатов гонки, таблице финишёров и
  рейтинге сезона показывает его аватар и ведёт на `/riders/<publicId>`. Без согласия — как раньше: «Участник», без
  аватара и ссылки.
- Статистика профиля считает финиши без места (START и Verified без пульса) — новая метрика «Финиши».

# 3. Scope

## Контракты (`packages/contracts`, только аддитивно, `.default`)

- `RaceResultRow`, `RaceFinisherRow`, `SeasonStandingRow` (+ панельный `PanelSeasonStandingRow` наследует):
  `riderPublicId: RiderPublicId | null` и `riderAvatar: { id: AvatarId } | null`, по умолчанию `null`.
- `RiderStats.finishes`, `PublicRiderProfile.stats.finishes` (int, `.default(0)`).
- `PublicRiderRace.unranked: RESULT_UNRANKED_REASONS | null` (`.default(null)`): строка финиша без места —
  `place: null`, `tied: false`, `status: 'final'`, `unranked: 'start' | 'no_heart_rate'`.

## API

- `profile`: порт `RIDER_NAMES` — новый метод `publicRiders(userIds) → Map<userId, { name, publicId, avatarId }>`;
  условие то же, что у `publicNames` (`showNameInResults: true`, `publicName` — строка) — **в фильтре запроса**.
  `ProfileRepository.findPublicRiders` — один `find` по `_id`, проекция `publicName, publicId, avatarId`.
- `results`: `ResultsReadService.withRiderNames` и `finishers` — через `publicRiders`; строка — явным списком полей.
  `standings`: `StandingsReadService.page` — через `publicRiders` (публичная и панельная таблица).
- `results`: порт `RIDER_RESULTS.publishedFinishes(userId)` — заявки-финишёры пользователя (фильтр как у таблицы
  финишёров: `active`, `best` есть, `best.ranked: false`, `disqualified: null`; индекс `race_entries_user_idx`) только
  по гонкам с опубликованным протоколом (`currentRevisions` — есть ревизия). Предел 2000 + лог, как `publishedRows`.
- `riders`: `summarize(rows, finishes)` → `finishes = в зачёте + финиши без места`; `stats` и `publicProfile`
  отдают `finishes`; публичная история `pageRows` — строки протокола и финиши вместе (порядок и курсор прежние: одна
  строка на гонку).

## Приложение (`apps/app`, iOS/Android/web одним кодом)

- Ячейка «кто» таблиц: аватар `size.avatarStack` (`RiderAvatar`, decorative) + имя — только у публичного райдера
  (`riderPublicId !== null`); «Участник» — без аватара.
- Нажатие строки: приоритет — прежнее действие (карточка соперника / «Ваш результат»); иначе при `riderPublicId` —
  переход на `/riders/<publicId>` (`accessibilityRole="link"`, метка «Профиль райдера, <имя>»). Финишёры и рейтинг
  сезона — то же. В карточке соперника — `TextAction` «Профиль райдера», если у строки есть `riderPublicId`.
- Профиль (свой и публичный): метрика «Финиши» рядом с «В зачёте». Публичная история — строка финиша без места
  «Финишёр» (как статус в своей истории).

# 4. Out of scope

- Панель «Протокол» («Участники», «Попытки»): ссылок и аватаров нет.
- Изменение «В зачёте», подиумов и достижений (A1 «Пять гонок» по-прежнему по `isRankedRow`).
- Карточки для сторис и OG-картинки.

# 5. Acceptance criteria

1. Публичная таблица гонки (предварительная и опубликованная), финишёры и таблица сезона: у райдера с именем и
   согласием — `riderName`, `riderPublicId`, `riderAvatar` (если фото есть); без согласия или без имени — все три
   `null`. Ключи строки — ровно явный список, `userId` нет (int-тесты ключей).
2. Отзыв согласия — в следующем ответе (вне HTTP-кэша `max-age=60`) поля `null`.
3. `GET /v1/profile/stats` и `GET /v1/riders/:publicId` — `finishes` = строки «в зачёте» + финиши без места по гонкам с
   опубликованным протоколом; до публикации, снятая заявка, DQ — не считаются. `races`/`podiums` не меняются.
4. `GET /v1/riders/:publicId/races` — финиш START после публикации протокола: `place: null`, `unranked: 'start'`;
   курсор — только id гонки.
5. Приложение: строка публичного райдера — аватар и переход на `/riders/<publicId>`; карточка соперника — «Профиль
   райдера»; «Участник» — не нажимается (если нет действия соперника). Профиль — «Финиши N».

# 6. Test matrix

| AC | Тест | Файл |
|---|---|---|
| 1, 2 | int: строки с/без согласия, ключи, отзыв | `results/results-read.int.test.ts` (или ближайший int таблицы), `standings/standings-read.int.test.ts` |
| 1 | unit: фильтр `publicRiders` | `profile/rider-names.test.ts` |
| 3, 4 | unit `summarize`/`pageRows`; int статистики и истории со START | `riders/riders.policy.test.ts`, `riders/riders.int.test.ts` |
| 1 | contracts: значения по умолчанию | `results.schema.test.ts`, `standings.schema.test.ts`, `rider-profile.schema.test.ts` |
| 5 | RNTL: строка-ссылка, аватар, «Участник» без ссылки, карточка соперника, «Финиши» | `apps/app/src/__tests__/*` |

# 7. Security checklist

- AuthN/AuthZ: эндпоинты не меняются (публичные — `PublicReadGuard`, свои — `AuthGuard`).
- Входные данные: новых входов нет.
- Данные наружу: `publicId` и id фото — только при имени и согласии, условие в фильтре порта (как имя, P1); без
  `userId`. Финиши без места уже публичны в таблице финишёров; в публичном профиле — только при согласии (R4).
  Фото после отзыва согласия получает новый id (S8) — старые ссылки из закэшированных таблиц 404.
- Злоупотребления: лимиты прежние; чтение `publicRiders` — один запрос на страницу (≤ 100 id).
- Логи: новых логов с ПДн нет (`riders.finishes_truncated uid limit`).
- Аудит: мутаций нет.

# 8. Решения

- Развилка RC-A3 (пользователь, 2026-10-29): отдельная метрика «Финиши» в своём и публичном профиле, финиши START —
  в публичной истории; «В зачёте» и достижения не меняются.
- Приоритет нажатия строки — прежние действия (споры, сторис), профиль — из карточки соперника.

## 8.2 Отклонения и решения реализации

- Метка строки-ссылки: начинается с «Профиль райдера, <имя>» и сохраняет данные строки — «Профиль райдера, Анна К.,
  2-е место поровну, 1:00:00» (финишёры — время и почему без места, сезон — место и очки): иначе скринридер теряет
  место и время. В своей строке — по имени, не «Вы».
- Своя строка без «Ваш результат» у публичного райдера — тоже ссылка на свой публичный профиль (правило «иначе при
  `riderPublicId`»); аватар — у любой строки с `riderPublicId`, включая «Вы».
- «Профиль райдера» (`TextAction`) — только в карточке соперника; на своей карточке («Ваш результат») — нет.
- Строки таблиц (результаты, финишёры, сезон) — `minHeight: size.touchMin`: строка может быть ссылкой.
- Общие части строки — `apps/app/src/features/races/table-row.tsx` (`TableRow`, `RiderWho`, `useRowAction`); аватар —
  существующий `RiderAvatar` (декоративный, `size.avatarStack`); без фото — иконка человека.
- Порядок метрик профиля: «В зачёте», «Финиши», «Подиумы», «Лучшее место».
- `publicRiders` возвращает `publicId: null`, если у профиля его ещё нет (до бэкфилла): строка с именем, но без ссылки
  и аватара — как «нет профиля» для ссылки.

# 10. Documentation Sync

- `docs/product/profile.md`: R6 — метрика «Финиши», R9 — финиши в публичной статистике и истории, строки таблиц со
  ссылкой и аватаром; Follow-up — пункты таблиц и RC-A3 (b) закрыты, добавлены web-`Link` и сброс кеша таблиц.

# 12. Outcome

- Контракты: `RiderRowLink` (`riderPublicId`, `riderAvatar`, `.default(null)`) в `RaceResultRow`, `RaceFinisherRow`,
  `SeasonStandingRow` (панельная наследует); `RiderStats.finishes`, `PublicRiderProfile.stats.finishes`
  (`.default(0)`), `PublicRiderRace.unranked` (`.default(null)`).
- API: `RIDER_NAMES.publicRiders` (+ `ProfileRepository.findPublicRiders`, условие согласия и имени в фильтре),
  `riderRowFields` — явный список полей строки; таблицы результатов, финишёров и сезона (публичная и панельная) —
  через `publicRiders`. `RIDER_RESULTS.publishedFinishes` (заявки-финишёры по `race_entries_user_idx`, только гонки с
  ревизией, предел 2000 + лог). `riders`: `summarize(rows, finishes)` → `finishes`; публичная история — `historyRows`
  (строки протокола + финиши без места, одна строка на гонку, курсор прежний).
- Приложение: ячейка «кто» с аватаром у публичного райдера; строка-ссылка на `/riders/<publicId>` в таблице гонки,
  финишёрах и таблице сезона (прежние действия строки важнее); «Профиль райдера» в карточке соперника; метрика
  «Финиши» в своём и публичном профиле; финиш без места в публичной истории — «—» и «Финишёр».
- Тесты: int — ключи и значения строк с/без согласия, отзыв согласия (`results-names`, `standings-read`,
  `results-tiers`), финиши и история со START (`riders.int`); unit — `publicRiders`, `summarize`/`historyRows`,
  форматтеры приложения; contracts — значения по умолчанию; RNTL — `rider-links.test.tsx`, профиль
  (`own-profile`, `rider-profile`).
- Проверки (2026-10-29): `pnpm check` (Mongo/Redis db 6 агента) — EXIT 0, 15/15 задач (app 2157, api 1982,
  admin 383, contracts 426 тестов); `build:web` — EXIT 0; `E2E_API=1 pnpm e2e:web` (своя БД, Redis db 7, свой
  Mailpit) — 38 passed; `expo export -p android` — EXIT 0. Флейки вне задачи (прошли при повторе):
  `tickets-email.int.test.ts` (таймаут 20 с), `rides-moderation.int.test.ts`.
- Слияние `origin/develop` — без конфликтов; после него: фикстура `PanelSeasonStandingRow` в admin, тест модульной
  границы (`profilesCollection` в `apps/api/test/standings.ts`), комментарий `rider-results.ts` (сторож коллекций
  протокола по имени).
- NOT VERIFIED: ручная проверка на iOS/Android-симуляторе и в браузере.
