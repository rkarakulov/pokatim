# 1. Title

Результат гонки, слайс 04: участие и результат в приложении — «Участвовать», блок «Ваше участие» (время, статус,
предварительное место, попытки с причинами), «Загрузить заезд» и «Выбрать свой заезд» в гонку, «Отменить участие» с
подтверждением, предварительная таблица «Результаты» на карточке гонки; iOS, Android, web

# 2. Goal

Слайс 04 эпика `docs/tasks/2026-10-27-race-results/epic.md` (§3.2, §3.4, §7). Слайс 03 (PR #39) дал API, контракты
(`packages/contracts/src/results/results.schema.ts`), методы api-client (`getMyRaceEntry`, `enterRace`,
`withdrawFromRace`, `addRaceAttempt`, `listAttemptCandidates`, `getRaceResults`) и ключи i18n
(`races.entry.*`, `races.result.*`, `races.attempt.*`, `races.block.*`, `races.results.*`, `races.error.*`). Здесь —
только экраны приложения:

- райдер на карточке гонки нажимает «Участвовать» (гость — после входа с возвратом к гонке);
- загружает файл заезда прямо в гонку или выбирает свой заезд из импортированных;
- сразу видит подтверждение и «Ваше время»; пока трек проверяется — «Проверка трека» и «Место появится после
  проверки.»; когда проверка завершится, место появляется **тихо**, без уведомления (D-37, polling);
- видит каждую свою попытку со статусом и причиной отказа;
- видит предварительную таблицу гонки: анонимные строки «Участник», своя — «Вы», ничья «=N» (A7, A12);
- может отменить участие с подтверждением последствий (C1/H2).

Клиент присылает только намерение; время, место, статус и вердикт — с сервера (`AGENTS.md` §4.1).

Источники: эпик §3.2–§3.4, §6 (A4–A8), §7; spec слайса 03 (§7.1 эндпоинты, §7.4 статусы и действия, §7.10 тексты,
§8.2 решения A12–A14); `docs/product/races-and-seasons.md` («Участие и результат»); прототипы автора «Результат после
загрузки» и «Гонки» (конфиденциальны — в репозиторий не копируются, ниже только решения и коды D-xx);
`.claude/rules/{app,pokatim-app,tests,pokatim-tests,security,pokatim-security}.md`; образец публичной карточки с
действием вошедшего — `features/rides/ride-detail.tsx` (блок 05).

# 3. Scope

**Карточка гонки `/races/[id]` (`features/races/race-detail.tsx`) — новые блоки**

1. **«Ваше участие»** (`features/races/participation/*`) — сразу под героем, до строк окна/коридора:
   - **гость** — если у гонки есть коридор и фаза `upcoming|open`: primary «Участвовать» → `rememberReturnPath('/races/<id>')`
     + `/sign-in` (как «Я иду» в райдах, Q13 блока 05); после входа — возврат к карточке, заявка — повторным нажатием;
     под кнопкой мета «Войдите, чтобы участвовать». Без коридора / отменена / закрыта — блока нет.
   - **вошедший** — `GET /v1/races/:id/entry` (`no-store`), ключ `['races', 'entry', id]`:
     - нет заявки, `canEnter` — primary «Участвовать» (мутация `enterRace`, кнопка выключена на время запроса, отказ —
       текст у кнопки по коду `races.error.*`);
     - нет заявки, `!canEnter` — строка причины `races.block.<reason>` (первая причина **заявки** из `reasons`, §8.1 F1;
       `no_corridor` — тоже; `cancelled` — блока нет, баннер отмены уже есть, F8);
     - заявка `active` — блок результата (ниже) + действия + список попыток;
     - заявка `withdrawn` — нейтральный баннер «Участие отменено» + «Вы отменили участие в этой гонке», без действий.
   - **Блок результата** (`MyRaceEntry.result`):
     - кикер «Ваше участие»; плашки (`Pill`): статус результата `races.result.status.<status>` — `pending` tone
       `warning`, `provisional` — `neutral` «Предварительный», `not_counted` — `error`, `dns`/`none` — `neutral`;
     - «Ваше время» — крупно (`textStyle` дисплейный, цифры tabular), `elapsedSec` → `h:mm:ss` (`formatElapsed`; только при `elapsedSec !== null`, §7.2);
     - баннер: `pending` — `warning` «Место появится после проверки.» (D-37); `provisional` с местом —
       нейтральный (`Banner tone="info"`, §8.1 F2) «Предварительно {place}-е место до публикации протокола {date}.» /
       `placeTied` при ничьей;
       `provisional` без места — `provisionalNote`; дата протокола — `race.protocolPlannedAt` (Минск; год — только если не текущий, §8.1 F6);
     - `ranked` — мета «Засчитано: {count}» рядом с местом не нужна (есть в таблице).
   - **Действия** (по `actions` сервера, не по локальным правилам):
     - `canAddAttempt` — «Загрузить заезд» (primary, если видимых попыток нет; иначе secondary «Загрузить ещё заезд»)
       и secondary «Выбрать свой заезд» (→ `/races/pick/<id>`); мета «Загрузить заезд можно до {date}, {time}»
       (`uploadClosesAt`);
     - `!canAddAttempt` при активной заявке — строка причины `races.block.<reason>` — первая причина **попытки** из
       `reasons` (`cancelled`, `window_not_open`, `upload_closed`, `attempt_limit`; не `reasons[0]` — там бывает
       `window_closed` отмены, §8.1 F1);
     - `canWithdraw` — `TextAction` destructive «Отменить участие» → инлайн-подтверждение (§7.4).
   - **Попытки** (`attempts`, новые сверху, только видимые) — строка: дата/время заезда «8 октября, 19:42»
     (`activity.startedAt`, Минск), источник (`tracks.source.*`: «Файл» / «Garmin» / «Wahoo»; формата FIT/GPX в ответе нет,
     §8.1 F3), происхождение
     `races.attempt.origin.*`, статус `races.attempt.status.*`; `counted` — время сегмента + метка «Лучший» у
     `isBest` [ASSUMPTION copy: `races.attempt.best` «Лучший»]; `rejected` — причина `races.attempt.reason.<reasons[0]>`;
     `failed` — `races.attempt.failedHint`.
   - **Незавершённые загрузки в гонку** (`pendingUploads`) — строка «Файл обрабатывается…» или «Файл не принят:
     {reason}» (`tracks.failure.*`, как в «Устройствах»).
   - **Polling** — `refetchInterval` 3 с, пока есть попытка `queued|checking`, незавершённая `pendingUploads` или
     `result.status = pending`; иначе стоп. Смена лучшего времени/места (`result.elapsedSec`, `result.place`) —
     инвалидация таблицы `['races', 'results', id]`: место появляется тихо.
2. **«Загрузить заезд» в гонку** — системный выбор файла и отправка тем же хуком, что в «Устройствах»
   (`useTrackFileUpload`, pre-check, прогресс, «Отменить»), после ответа загрузки — `addRaceAttempt({ uploadId })`
   (два шага, Q2 слайса 03). Ответ — новый `MyRaceEntry` в кеш. Ошибка второго шага — баннер с текстом
   `races.error.*`; файл при этом уже принят и станет автоматической попыткой, если подходит (сервер).
3. **Экран «Выбрать свой заезд» `/races/pick/[id]`** (только вошедшим, без таб-бара, под тем же гардом, что
   `rides/edit/[id]`): `DetailHeader` «Выбрать свой заезд», список `listAttemptCandidates` (дата/время, источник,
   дистанция, длительность); уже добавленные (`attempted`) — выключены с пометкой [ASSUMPTION copy:
   `races.pick.attempted` «Уже в гонке»]; нажатие — `addRaceAttempt({ activityId })` → кеш `['races','entry',id]` →
   `router.back()` к карточке. Пусто — `EmptyState` [ASSUMPTION copy: `races.pick.empty` «Нет заездов в окне гонки»
   + `races.pick.emptyHint` «Загрузите файл заезда или дождитесь импорта Garmin/Wahoo.»]. Состояния §4.12 —
   скелетон, «Нет соединения» / «Не удалось загрузить» + «Повторить».
4. **Предварительная таблица «Результаты»** (`features/races/results-table.tsx`) — на карточке под полями гонки,
   для гонки с коридором в фазе `open|closed` (до открытия окна и у отменённой — нет):
   - заголовок «Результаты», плашка «Предварительный», мета «Засчитано: {ranked}»;
   - строки: место (`place`, `tied` → «={place}», колонка мест), «Участник» / «Вы» (своя — `entryId` = id своей
     заявки; акцентная полоса и метка «Вы», не только цветом), время `h:mm:ss` tabular;
   - публичный `getRaceResults` (страница 50), «Показать ещё» (`TextAction`) по `nextCursor`;
   - пусто — «Пока нет засчитанных результатов»; ошибка — компактный баннер с «Повторить» (карточка гонки не ломается).
5. **Отмена участия** — инлайн-подтверждение в блоке (не модалка, одинаково на всех платформах): заголовок
   «Отменить участие?», текст C1/H2 (`races.entry.withdrawBody`), destructive «Отменить участие» и secondary «Оставить
   участие»; мутация `withdrawFromRace`; ответ — новый `MyRaceEntry`, инвалидация таблицы.

**Инвалидация после мутаций участия:** `['races', 'entry', id]` — ответом мутации (`setQueryData`), затем
`['races', 'results', id]`. Список загрузок «Устройств» (`['tracks', 'uploads', …]`) — после загрузки файла (как
сейчас делает хук).

**i18n** (`packages/i18n/src/ru.ts`) — только недостающие ключи (§7.6), формальное «вы».

# 4. Out of Scope

- Споры (D-39, D-44, «Оспорить результат») — слайс 06; **карточка соперника** — тоже позже (§8.2 D1).
- Verified/START, кластеры и переключатель групп, данные Verified — слайс 07; имена/клубы/тренеры — слайс профиля (A12).
- «Поделиться» результатом, публичная карточка результата по ссылке, OG результата — вне эпика.
- Статус участия на карточках списка гонок («Verified — ждём трек»), «Мои дела», Главная — позже (пакетного API нет).
- Карта коридора и трека (MapLibre) — вне эпика.
- Фаза `final`, финальные статусы, протокол — слайс 05 (`tolerantEnum` уже даёт `unknown` — нейтральный показ).
- Изменения API и контрактов — нет (кроме i18n).

# 5. Architecture Context

- Приложение `apps/app` (Expo Router, TanStack Query, `@rkarakulov/ui`), пакеты `@pokatim/contracts` (типы
  `MyRaceEntry`, `MyAttempt`, `RaceResultsPage`, `AttemptCandidates`), `@pokatim/api-client`, `@pokatim/i18n`.
- API не меняется. Эндпоинты — §7.1 spec слайса 03. Ответы — `tolerantEnum`: незнакомое значение — `unknown`, показ
  нейтральный (`races.*.unknown`).
- Публичная карточка гонки — вне гардов (SSR + OG как сейчас); блок участия и таблица — только клиентские запросы
  (в SSR не попадают: `loader` сеет только `RaceDetail`). «Моё участие» — `AuthGuard`, `no-store`; таблица — публичная
  (`public, max-age=60`, `staleTime` 60 с, кроме инвалидации после своих изменений).
- Новый маршрут `src/app/races/pick/[id].tsx` — под `Stack.Protected` вкладок в `_layout.tsx` (как `rides/edit/[id]`).
- Загрузка файла — переиспользование `features/devices/use-track-file-upload.ts` с колбэком «загрузка принята»
  (расширение хука, поведение «Устройств» не меняется).

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** `useTrackFileUpload`, `pickTrackFile`, `sendTrackFile`, `uploadStatus`/подписи источников и
  `tracks.failure.*` (`features/devices/format.ts`); `rememberReturnPath` + allowlist (уже пускает `/races/<id>`);
  `withAccessToken`, `AUTH_MUTATION`; `DetailHeader`, `DocumentTitle`, `OfflineBanner`, `SectionHero`; из
  `@rkarakulov/ui` — `Button`, `TextAction`, `Banner`, `Pill`, `Kicker`, `EmptyState`, `AsyncContent`, скелетоны;
  форматы дат Минска (`lib/minsk-format.ts`); тексты ошибок — `races.error.<code>` + общий маппинг сети/429
  (как `rideActionErrorText`).
- **Запрещённые дубли:** вторая реализация выбора/отправки файла; локальное вычисление места, статуса, «можно ли
  загрузить/отменить» (только `actions` и `result` сервера); копия форматтера длительности — если есть общий, взять
  его, иначе один `formatElapsed` в `features/races/format.ts` с тестом.
- Логика (статус → тон плашки, текст баннера, условие polling, строка таблицы) — чистые функции в
  `features/races/participation-format.ts` (или `format.ts`) с юнит-тестами; компоненты — тонкие.
- Запросы и мутации — `features/races/queries.ts` (рядом с `useRace`).
- (architect) Общая разметка прогресса — `features/devices/upload-progress.tsx` (`UploadProgress`), её используют
  `TrackUploadBlock` и блок гонки; `FakeXhr` тестов — `__tests__/fake-xhr.ts` (общий для «Устройств» и гонки).
  Тексты ошибок — `raceActionErrorText` = `races.error.<code>` + `actionErrorMessage`; новых ключей сети/429 нет.

# 6. Relevant Files

- `apps/app/src/features/races/race-detail.tsx` — карточка гонки, сюда встраиваются блоки.
- `apps/app/src/features/races/queries.ts` — ключи и запросы гонок; + участие, таблица, мутации.
- `apps/app/src/features/races/format.ts` — форматы гонки; + `formatElapsed`, тексты результата.
- `apps/app/src/features/devices/use-track-file-upload.ts` — загрузка файла (расширить колбэком).
- `apps/app/src/features/devices/format.ts` — статусы загрузок, подписи источников.
- `apps/app/src/features/rides/ride-detail.tsx`, `rides/queries.ts` — образец действия гостя/вошедшего и ошибок.
- `apps/app/src/app/_layout.tsx` — гард нового маршрута.
- `apps/app/src/__tests__/race-detail.test.tsx` — тесты карточки.
- `packages/contracts/src/results/results.schema.ts` — типы ответов (не менять).
- `packages/api-client/src/index.ts` — методы (не менять).
- `packages/i18n/src/ru.ts` — тексты.

# 7. Implementation Notes

### 7.1 Состояния блока «Ваше участие» (по порядку)

| Условие | Показ |
|---|---|
| гость, коридор, фаза `upcoming\|open` | «Участвовать» → вход с возвратом |
| гость, иначе | ничего |
| сессия ещё неизвестна (`isSessionPending`, web-восстановление, SSR) | ничего (§8.1 F7) |
| вошедший, `entry` грузится | скелетон строки (без кнопки) |
| вошедший, ошибка `entry` при показанной гонке | баннер `warning` «Не удалось загрузить ваше участие» + «Повторить» [ASSUMPTION copy: `races.entry.failed`] |
| `entry = null`, `canEnter` | «Участвовать» |
| `entry = null`, `!canEnter`, причина заявки `cancelled` | ничего (баннер отмены карточки, F8) |
| `entry = null`, `!canEnter` | причина `races.block.<enterBlockReason>` (мета, F1) |
| 404 `entry` (старый API) | ничего (R4, F9) |
| `entry.status = withdrawn` | баннер «Участие отменено» + `races.block.withdrawn` |
| `entry.status = active` | результат + действия + попытки + загрузки |
| `entry.status = unknown` | как `withdrawn`, без текста причины (нейтрально) |

### 7.2 Результат → показ (`result.status`)

| Статус | Плашка | Время | Баннер |
|---|---|---|---|
| `none` | «Нет заездов» neutral | — | — |
| `pending` | «Проверка трека» warning | — | warning «Место появится после проверки.» |
| `provisional` | «Предварительный» neutral | `elapsedSec` | place ? (`tied` ? placeTied : place) : provisionalNote |
| `not_counted` | «Не засчитано» error | — | — (причины — в попытках) |
| `dns` | «Не стартовал» neutral | — | — |
| `withdrawn` | (блок withdrawn) | — | — |
| `unknown` | «—» neutral | `elapsedSec`, если есть | — |

`pending` при наличии `best` невозможен по серверу (§7.4 слайса 03: `provisional` первым) — показ по статусу, без
локальной логики. D-37: при `pending` «Ваше время» не показываем — сегмента ещё нет.

### 7.3 Polling и «место появляется тихо»

- `refetchInterval: (q) => needsPolling(q.state.data) ? 3000 : false`; `needsPolling` — есть попытка
  `queued|checking`, или `pendingUploads` в незавершённом статусе (`isUploadInProgress`), или `result.status =
  pending`. Без фонового опроса (`refetchIntervalInBackground` false по умолчанию).
- Смена `result.place`/`result.elapsedSec`/`result.status` между ответами — `invalidateQueries(['races','results',id])`
  (эффект на изменение, не на каждый ответ). Уведомлений/тостов нет (D-37). Live-region: баннер результата —
  `accessibilityLiveRegion="polite"` на обёртке-`View` (у `Banner` такого пропа нет, §8.1 F2; как «Отправлено» в
  «Устройствах»).

### 7.4 Отмена участия

- Инлайн-панель внутри блока: `accessibilityRole="alert"` не нужен; фокус — на заголовок подтверждения
  (`accessibilityLabel`). Тексты `races.entry.withdrawTitle/Body/Confirm/keep`.
- На время мутации обе кнопки выключены; ошибка — текст под кнопками (`races.error.RACE_WITHDRAW_CLOSED` и др.);
  успех — панель закрывается, блок показывает `withdrawn`.

### 7.5 Загрузка в гонку

- Хук загрузки получает `onUploaded(upload: TrackUpload)`; блок участия передаёт `(u) => addAttempt.mutate({ uploadId:
  u.id })`. Состояния прогресса/отмены/ошибки pre-check — как в `TrackUploadBlock` (переиспользовать разметку
  прогресса: вынести общий `UploadProgress` из `track-upload-block.tsx`, если иначе — копия; копия запрещена §5.1).
- Ошибка `addRaceAttempt` (`ATTEMPT_UPLOAD_CLOSED`, `ATTEMPT_LIMIT`, `ATTEMPT_SOURCE_INVALID`, `RACE_ENTRY_REQUIRED`,
  сеть, 429) — баннер `error` с текстом; повтор — новой загрузкой или «Выбрать свой заезд».
- Уход с экрана прерывает отправку (как в «Устройствах», v1).

### 7.6 i18n — новые ключи (`[ASSUMPTION copy]`)

`races.entry.failed` «Не удалось загрузить ваше участие»; `races.entry.withdrawnBanner` «Участие отменено» (или
`races.result.status.withdrawn` — переиспользовать, если подходит); `races.attempt.best` «Лучший»;
`races.pick.title` «Выбрать свой заезд» (= `races.entry.pickRide`, переиспользовать); `races.pick.attempted` «Уже в
гонке»; `races.pick.empty` «Нет заездов в окне гонки»; `races.pick.emptyHint` «Загрузите файл заезда или дождитесь
импорта Garmin/Wahoo.»; `races.results.more` «Показать ещё»; `races.results.failed` «Не удалось загрузить
результаты». Ключи, которые уже есть, не дублировать.

### 7.7 Доступность

- Плашки — текст, не только цвет; строка «Вы» — метка текстом.
- Строка таблицы — `accessibilityLabel` «{место}, {Участник|Вы}, {время}»; ничья — «=2» читается как «поровну 2»
  [ASSUMPTION copy `races.results.tiedA11y` «{place}-е место поровну»].
- Кнопки в процессе — `disabled` + `accessibilityState.busy`.

# 8. Risks / Assumptions / Open Questions

- **R1. Polling на открытой карточке** в вечер закрытия окна — запрос раз в 3 с на зрителя с проверкой в очереди;
  `no-store` эндпоинт лёгкий (одна заявка + ≤ 30 попыток). Приемлемо; стоп при отсутствии ожидающих.
- **R2. Ошибка второго шага загрузки** (`addRaceAttempt`) — файл принят, попытка не создана явно. Автоматическая
  попытка покроет подходящий заезд (сервер, A8); райдер может «Выбрать свой заезд».
- **R3. Таблица на сотни строк** — страницы по 50 в `ScrollView` карточки; виртуализация не нужна при v1-объёмах.
- **R4. Старый API** без эндпоинта участия (404 на `entry`) — блок участия не показывается (нейтрально), карточка
  работает.
- **A. Допущения** `[ASSUMPTION]`: размещение на карточке гонки, инлайн-подтверждение, отложенная карточка соперника,
  тексты §7.6, тоны плашек.

# 8.1 Requirements Consistency

Architecture Review — race-results-04-app. **Status: CONCERNS** (блокеров нет; находки ниже сняты правками spec
или решением по умолчанию — рекомендацией). Проверено кодом: `results.schema.ts`, `api-client/src/index.ts`
(`getMyRaceEntry`, `enterRace`, `withdrawFromRace`, `addRaceAttempt`, `listAttemptCandidates`, `getRaceResults` — все
есть, сигнатуры `(accessToken, raceId[, body])`, `getRaceResults(raceId, { limit, cursor })` публичный), ключи
`races.*` в `ru.ts`, `apps/api/src/modules/results/results.policy.ts` (`entryActions`, `resultStatus`), `_layout.tsx`,
`use-track-file-upload.ts`, `track-upload-block.tsx`, `devices/format.ts`, `@rkarakulov/ui` (типы `Banner`, `Pill`,
`Button`, `TextAction`), `design-tokens` (`typography`), `race-detail.test.tsx`, `devices-screen.test.tsx`,
`e2e/web.spec.ts`.

**F1 (MEDIUM, правка §3 п.1 и §7.1) — `actions.reasons` общий для трёх действий; «первая причина» показывает не ту.**
`entryActions` складывает в один массив причины отмены и добавления попытки: активная заявка в фазе `closed` после
срока загрузки → `['window_closed', 'upload_closed']`; `reasons[0]` даст «Окно закрыто» вместо «Срок загрузки заездов
истёк». Без заявки — `[<причина заявки>, 'not_entered']` (тут `reasons[0]` верна).
- (a) **[рекомендация, внесено в spec]** чистые функции выбирают первую причину **из подмножества своего действия**:
  заявка — `cancelled | no_corridor | entries_closed | withdrawn | unknown`; попытка — `cancelled | window_not_open |
  upload_closed | attempt_limit | unknown`. Это выбор текста из ответа сервера, не локальное правило (`can*` — только
  сервер). Регресс-кейс `['window_closed','upload_closed']` → `upload_closed` — в юнит-тесте.
- (b) `reasons[0]` как было — неверный текст после окна.
- (c) причины по действиям в контракте (`actions.enterReasons` …) — правка API/контрактов, вне scope.

**F2 (LOW, правка §3/§7.3) — в `@rkarakulov/ui` нет «нейтрального» баннера и live-region у `Banner`.** `BannerTone =
'info' | 'warning' | 'error'` → «нейтральный» = `info`. `Banner` не принимает `accessibilityLiveRegion` — обернуть
баннер результата в `View accessibilityLiveRegion="polite"`. `Pill` — `neutral | accent | success | warning | error`,
тоны §7.2 допустимы.

**F3 (LOW, правка §3) — источника «FIT/GPX» в ответе нет.** `MyAttempt.activity.source` и кандидаты —
`tolerantEnum(['upload','garmin','wahoo'])`, формата файла нет → подписи `tracks.source.*` («Файл», «Garmin»,
«Wahoo»), `unknown` — «Файл» (как `uploadTitle`).

**F4 (решено) — общего форматтера длительности нет** (проверены `apps/app/src`, `apps/admin/src`, `@rkarakulov/i18n-core`,
`@rkarakulov/ui`, `packages/contracts/src/time.ts`). → один `formatElapsed(sec)` в `features/races/format.ts`, всегда
`h:mm:ss` («0:42:07», «1:02:05», часы не ограничены: «25:01:01»), цифры — стили с `tabularNums` (`displayNumeral36` /
`time`). Кандидат в общий код — когда появится второй потребитель (панель 05).

**F5 (LOW, правка §8.3) — тексты сети/429.** Ключей `races.error.network/rateLimited/unknown` нет. → `raceActionErrorText`:
`races.error.<code>` для 7 кодов слайса 03, иначе общий `actionErrorMessage` (`features/auth/error-messages.ts`: «Нет
соединения» / «Слишком много попыток. Попробуйте позже.» / сбой) — как `deviceActionErrorMessage`. Новых ключей нет;
429 — без секунд ожидания (в §8.3 было «с ожиданием» — уточнено).

**F6 (LOW) — даты в блоке.** Правило карточки «публичный экран — даты с годом (`now = null`)» относится к SSR-частям.
Блок участия, таблица и экран выбора — только клиентские (после гидрации сессии), `now` — из
`useMinskClockAfterMount` карточки. → попытки и кандидаты — `formatMinskDateTime(iso, now)` из `devices/format.ts`
(«8 октября, 19:42», год — если не текущий); дата протокола в баннере и «Загрузить заезд можно до …» — `minskDateTime(iso,
now)` (`lib/minsk-format.ts`, то же правило года). Пока `now = null` — строки с датами не рисуются (на клиенте это
первый кадр). Строка «Протокол» карточки не меняется (с годом).

**F7 (LOW, правка §7.1) — сессия ещё неизвестна.** На web при восстановлении сессии `status = 'unknown'` →
`isSignedIn = false`: вошедший увидел бы гостевое «Участвовать», нажатие увело бы на вход. → пока
`isSessionPending(status)` — блок участия не рисуется (SSR тоже без него). Строка добавлена в §7.1.

**F8 (LOW, правка §7.1) — отменённая гонка без заявки.** Причина `cancelled` дублирует баннер отмены карточки → блок не
рисуется. Отменённая гонка с заявкой — блок результата есть (статус с сервера), действий нет (`actions`).

**F9 (решено) — R4, 404 на `entry`.** `useMyRaceEntry` в `queryFn` переводит `NOT_FOUND` в `null` (как `useDevices` —
`EMPTY_DEVICES`): тип данных `MyRaceEntry | null`, `null` — блока нет. Гонка 404 — карточка «не найдена» раньше.

**F10 (решено) — Expo Router.** `src/app/races/pick/[id].tsx` → `/races/pick/<id>` (два сегмента): не пересекается с
`races/[id].tsx` (один сегмент) и `(tabs)/races` (`/races`). `/races/pick` без id уйдёт в `races/[id]` с `id = 'pick'` →
`Uuid` невалиден → «Гонка не найдена» без запроса — приемлемо. Гард — `<Stack.Screen name="races/pick/[id]" />` в
первом `Stack.Protected` рядом с `rides/edit/[id]`; гость по прямой ссылке → «Вход»/«Регистрация» (как `rides/edit`).
Allowlist возврата не расширяется: экран выбора — не цель возврата гостя (кнопки у гостя нет).

**F11 (решено) — расширение хука загрузки.** `useTrackFileUpload(options?: { onUploaded?: (upload: TrackUpload) => void })`
— колбэк через `useRef` (не в зависимостях `choose`), вызывается после `setState({ phase: 'sent' })` только для текущей
отправки (`isCurrent()`). Кеш `['tracks','uploads',{limit:20}]` хук обновляет как сейчас. Блок гонки состояние `sent`
не показывает (статус файла — из `pendingUploads`/`attempts` ответа). Разметка прогресса — общий `UploadProgress`
(`features/devices/upload-progress.tsx`), `TrackUploadBlock` переходит на него без смены поведения (AC12).
Импорт `features/races → features/devices` разрешён (`.dependency-cruiser.cjs`: правил между фичами нет; обратного
импорта нет — цикла нет).

**F12 (решено) — ключи таблицы.** Таблица — `useInfiniteQuery` с ключом `['races','results',id,'pages']` (конвенция
`'pages'` проекта для `InfiniteData`); инвалидация — префиксом `['races','results',id]` (§3 верен).

**F13 (решено) — «место появляется тихо».** Эффект в `useMyRaceEntry`: подпись `resultSignature(data)` = `status|place|
tied|elapsedSec`; изменилась относительно прошлого ответа (не первый ответ) → `invalidateQueries(['races','results',id])`.
Мутации инвалидируют таблицу сами (`applyEntry`).

**F14 (решено) — AC16.** Мутации участия: `onError` с 409-кодами `RACE_ENTRY_*`, `RACE_WITHDRAW_CLOSED`, `ATTEMPT_*` →
`invalidateQueries(['races','entry',id])` (актуальные `actions`), текст — у кнопки.

**F15 (тесты) — автомок `api`.** `jest.mock('@/lib/api')` вернёт `undefined` из новых методов → у вошедшего в
`race-detail.test.tsx` и `season.test.tsx` запрос участия упадёт («data cannot be undefined»). → `beforeEach`:
`getMyRaceEntry` → `noEntry` (фабрика в `__tests__/races-fixtures.ts`), `getRaceResults` → пустая страница. Ожидания
существующих тестов не меняются (гонка фикстуры без коридора, `upcoming` — ни кнопки гостя, ни таблицы).

**F16 (рекомендация) — смоук web.** `app.md`: новый маршрут — шаг смоука. Экран выбора — за входом и требует открытого
окна, поэтому шаг — минимальный: гость на `corridorRace` (фикстура, фаза `upcoming`) видит «Участвовать» и «Войдите,
чтобы участвовать»; на `race` без коридора — нет. Экран `/races/pick/<id>` вошедшим (уже залогиненный райдер смоука) —
заголовок «Выбрать свой заезд» и пустое состояние. Если `E2E_API` не включён — `NOT VERIFIED` в pr.md.

**Конфликтов с инвариантами нет:** клиент шлёт только намерение (`{}`, `{ activityId }`, `{ uploadId }`); `can*`,
статусы, место, время — из ответа; polling — `refetchInterval` (§1, без сокетов/push); все платформы — без `Platform.OS`
(выбор файла уже развилен файлами `pick-track-file(.web).ts`, `upload-track(.web).ts`); SSR не затронут (`loader` сеет
только `RaceDetail`). Изменений контрактов и API нет.

# 8.2 Deviations from spec

- **D1 — карточка соперника отложена.** Эпик §7 (слайс 04) включает «карточку соперника (без спора)». Строки таблицы
  анонимны (A12), а без спора (06) карточка повторяла бы строку (место, «Участник», время). → Делаем вместе со спором
  (06) или именами (профиль). Принято оркестратором 2026-10-27 (автономный режим), отражено §4.
- **D2 — экран результата не отдельный.** Прототип показывает «результат после загрузки» отдельным экраном; здесь —
  блок на карточке гонки (тот же результат, «открытый позже», прототип ведёт туда же). Отдельный маршрут нужен для
  шеринга результата — вне эпика. Принято оркестратором 2026-10-27.

- **D3 (coder, оформление) — тоны плашек попыток.** Spec задаёт тоны только для результата (§7.2). Попытки:
  `checking` — `warning` (как `pending`), `counted` — `success`, `rejected` / `failed` — `error`, `queued` / `withdrawn` /
  `unknown` — `neutral`; «Лучший» — `Pill tone="accent"` (`ATTEMPT_TONES` в `participation-format.ts`).
- **D4 (coder) — подтверждение отмены.** В `@rkarakulov/ui` destructive есть только у `TextAction` (без `loading`):
  «Отменить участие» — `TextAction destructive` (выключен на время запроса, без `busy`), «Оставить участие» —
  `Button secondary`. Кнопки с `loading` («Участвовать», «Загрузить заезд») дают `busy` сами.
- **D5 (coder) — таблица без `AsyncContent`.** §3 п.4 требует компактный баннер ошибки внутри карточки (полноэкранное
  «Не удалось загрузить» `AsyncContent` выглядело бы как сбой карточки): скелетон `SkeletonListRow` в `SkeletonGroup`
  и баннер с «Повторить» — в `results-table.tsx`.
- **D6 (coder) — дефолтный мок участия в `race-detail` / `season` тестах** — `noEntry` с причинами `['no_corridor',
  'not_entered']` (а не `canEnter`): гонка фикстуры без коридора, так отвечает сервер. Ожидания тестов не менялись.

- **D7 (fix pass 1) — сигнатура `WithdrawConfirm`.** Вместо `{ raceId, onClose }` — `{ pending, onConfirm, onClose }`:
  мутация отмены живёт в `EntryActions`, чтобы текст отказа 409 оставался, когда сервер уже вернул `canWithdraw: false`
  (findings pass 1, MEDIUM 2).

# 8.3 Security checklist

- AuthN/AuthZ: «моё участие», мутации, кандидаты — `AuthGuard` на сервере (слайс 03); клиент токен — через
  `withAccessToken`. Экран выбора заезда — под гардом вошедших.
- Данные наружу: таблица — анонимные строки без ПДн; «Вы» определяется на клиенте по id своей заявки (из `no-store`
  ответа), в SSR/OG не попадает.
- Злоупотребления: лимиты — сервер (429 → общий текст `actionErrorMessage`, §8.1 F5); клиент не повторяет мутации
  автоматически.
- Секреты и логи: нет. Путь возврата — allowlist `return-path`.

# 9. Acceptance Criteria

**Функциональные**
1. Гость на гонке с коридором в фазе `upcoming|open` видит «Участвовать»; нажатие запоминает `/races/<id>` и
   открывает вход; без коридора / `closed` / `cancelled` — кнопки нет.
2. Вошедший без заявки с `canEnter` видит «Участвовать»; после ответа `enterRace` блок показывает активную заявку
   (действия по `actions` ответа).
3. Без `canEnter` — текст причины по первой `reasons`.
4. Активная заявка: плашка статуса, «Ваше время» (`provisional`), баннер места/«Место появится после проверки.» по
   §7.2; дата протокола — из гонки.
5. Попытки: статус, причина отказа, «Лучший», `failedHint`; `pendingUploads` — «Файл обрабатывается…» / «Файл не
   принят: …».
6. Polling включён при `queued|checking`/незавершённой загрузке/`pending`, выключен иначе; смена места —
   перезапрос таблицы без уведомления.
7. «Загрузить заезд»: файл → загрузка → `addRaceAttempt({ uploadId })` → кеш участия обновлён; pre-check отказ —
   баннер, запроса нет; ошибка второго шага — баннер с текстом кода.
8. «Выбрать свой заезд»: список кандидатов, `attempted` — выключен; выбор → `addRaceAttempt({ activityId })` →
   назад к карточке; пусто — EmptyState.
9. «Отменить участие» → подтверждение → `withdrawFromRace` → блок `withdrawn`; «Оставить участие» закрывает панель
   без запроса.
10. Таблица: места, «=N», «Вы» у своей строки, время `h:mm:ss`, «Показать ещё» по курсору, пусто и ошибка — §3.4;
    нет таблицы до открытия окна и у отменённой.

**Технические**
11. Нет локального вычисления места/статуса/прав — только поля ответа (`actions`, `result`).
12. Загрузка файла — тот же хук, что «Устройства»; тесты «Устройств» зелёные без правок ожиданий.
13. `tolerantEnum` `unknown` в статусах/причинах — нейтральный текст, без падения.
14. `pnpm check` зелёный (lint, typecheck, unit/int, depcruise); тесты карточки — RNTL с моками api.

**Негативные**
15. Ошибка `entry` при загруженной гонке — карточка видна, баннер с «Повторить»; 404 `entry` (старый API) — блока нет.
16. 409 `RACE_ENTRY_CLOSED`/`RACE_ENTRY_WITHDRAWN` на «Участвовать» — текст у кнопки, кеш участия перезапрошен.
17. Ошибка таблицы не ломает карточку.

# 10. Documentation Impact

- `docs/product/races-and-seasons.md` — раздел «Участие и результат»: строка «экраны — слайс 04» → что сделано
  (карточка гонки, выбор заезда, отложенная карточка соперника).
- Эпик §7 — пометка D1/D2 у слайса 04.
- `.claude/rules/pokatim-app.md` — раздел «Участие и результат (race-results-04)»: блок на карточке гонки (только
  клиент, не в SSR), ключи `['races','entry'|'results'|'candidates', id]`, polling `needsPolling` 3 с и тихая
  инвалидация таблицы, причины — по подмножеству действия (F1), `races/pick/[id]` под гардом вкладок, загрузка в гонку —
  `useTrackFileUpload({ onUploaded })` + `addRaceAttempt({ uploadId })`.
- ADR не требуется (UI поверх ADR-0012, без новых архитектурных решений).

# 11. Implementation Context

### ENTRY POINTS

- `apps/app/src/features/races/race-detail.tsx` — `RaceDetailScreen`: запросы участия и таблицы на уровне экрана
  (для pull-to-refresh), блоки `RaceParticipation` (под героем и баннером отмены, до строки «Окно») и `RaceResultsTable`
  (после описания).
- `apps/app/src/app/races/pick/[id].tsx` — новый маршрут → `RacePickScreen`.
- `apps/app/src/app/_layout.tsx` — `<Stack.Screen name="races/pick/[id]" />` в первом `Stack.Protected`.

### Порядок (TDD, каждый шаг — зелёные тесты; один PR)

1. **i18n** — новые ключи (ниже) в `packages/i18n/src/ru.ts` после `races.results.count` / `races.attempt.*`.
2. **Чистые функции** — тесты `participation-format.test.ts` и `format.test.ts` (красные) → `formatElapsed`,
   `participation-format.ts`.
3. **Запросы и мутации** — `features/races/queries.ts` (ключи, `useMyRaceEntry`, `useRaceResults`,
   `useAttemptCandidates`, 3 мутации, `applyEntry`).
4. **Загрузка** — `UploadProgress` вынесен из `track-upload-block.tsx`; `useTrackFileUpload({ onUploaded })`;
   `devices-screen.test.tsx` зелёный без правок ожиданий (общий `FakeXhr` → `__tests__/fake-xhr.ts`, импорт — да, правка
   ожиданий — нет).
5. **Блок участия** — RNTL-тесты `race-participation.test.tsx` (красные) → `features/races/participation/*` +
   встраивание в `race-detail.tsx`; дефолтные моки в `race-detail.test.tsx`, `season.test.tsx`.
6. **Таблица** — `race-results.test.tsx` → `results-table.tsx`.
7. **Экран выбора** — `race-pick.test.tsx` → `race-pick.tsx`, маршрут, гард, `app-routes.ts`.
8. Шаг смоука `e2e/web.spec.ts`, документация §10, `pnpm check`.

### FILES TO CREATE

- `apps/app/src/features/races/participation-format.ts` (+ `participation-format.test.ts`) — чистая логика показа.
- `apps/app/src/features/races/participation/race-participation.tsx` — контейнер блока (гость / вошедший / состояния
  §7.1).
- `apps/app/src/features/races/participation/entry-result.tsx` — кикер, плашка, «Ваше время», баннер (§7.2).
- `apps/app/src/features/races/participation/entry-actions.tsx` — «Загрузить заезд» / «Загрузить ещё заезд» (+ прогресс,
  ошибки двух шагов), «Выбрать свой заезд», мета срока, причина недоступности, «Отменить участие».
- `apps/app/src/features/races/participation/withdraw-confirm.tsx` — инлайн-подтверждение (§7.4).
- `apps/app/src/features/races/participation/attempt-list.tsx` — попытки и `pendingUploads`.
- `apps/app/src/features/races/results-table.tsx` — таблица (§3 п.4).
- `apps/app/src/features/races/race-pick.tsx` — экран «Выбрать свой заезд».
- `apps/app/src/app/races/pick/[id].tsx` — маршрут (без `loader`/`generateMetadata`: экран за входом).
- `apps/app/src/features/devices/upload-progress.tsx` — общий прогресс отправки (текст «Загружаем …: N%», полоса
  `progressbar`, «Отменить»).
- `apps/app/src/__tests__/races-fixtures.ts` — фабрики `myEntry`, `noEntry`, `attempt`, `resultsPage`, `candidates`.
- `apps/app/src/__tests__/fake-xhr.ts` — `FakeXhr` из `devices-screen.test.tsx` (общий для двух тестов).
- `apps/app/src/__tests__/race-participation.test.tsx`, `race-results.test.tsx`, `race-pick.test.tsx`.

### FILES TO MODIFY

- `apps/app/src/features/races/race-detail.tsx` — блоки, `refetchers` (+ `entry.refetch` у вошедшего, + `results.refetch`
  при показанной таблице).
- `apps/app/src/features/races/queries.ts` — ключи, хуки, мутации.
- `apps/app/src/features/races/format.ts` (+ `format.test.ts`) — `formatElapsed`.
- `apps/app/src/features/devices/use-track-file-upload.ts` — опция `onUploaded`.
- `apps/app/src/features/devices/track-upload-block.tsx` — `UploadProgress` вместо своей разметки.
- `apps/app/src/app/_layout.tsx` — экран под гардом вкладок.
- `apps/app/src/__tests__/app-routes.ts` — `'races/pick/[id]': RacePickRoute`.
- `apps/app/src/__tests__/race-detail.test.tsx`, `season.test.tsx` — дефолтные моки `getMyRaceEntry` / `getRaceResults`.
- `apps/app/src/__tests__/devices-screen.test.tsx` — импорт `FakeXhr` из `fake-xhr.ts` (ожидания не трогать).
- `apps/app/e2e/web.spec.ts` — шаг смоука (F16).
- `packages/i18n/src/ru.ts` — ключи.
- Документация — §10.

### FILES TO READ

`features/rides/ride-detail.tsx` (гость/вошедший, баннер «viewerFailed» с повтором), `features/rides/queries.ts`
(`applyRideView`, `networkMode: 'always'`), `features/rides/ride-manage.tsx` (экран за входом, `OwnRide`, ошибки
обновления), `features/devices/{use-track-file-upload.ts,track-upload-block.tsx,format.ts,error-messages.ts,queries.ts}`,
`features/auth/{error-messages.ts,return-path.ts,session-store.ts,authorized.ts}`, `lib/{minsk-format.ts,use-minsk-clock.ts,
use-pull-to-refresh.ts}`, `components/detail-header.tsx`, `__tests__/{race-detail,ride-detail,devices-screen}.test.tsx`,
`packages/contracts/src/results/results.schema.ts`, `apps/api/src/modules/results/results.policy.ts` (`entryActions`,
`resultStatus` — только чтение, для понимания `reasons`).

### TYPES & SCHEMAS

Контракты не меняются. Типы — `MyRaceEntry`, `MyAttempt`, `PendingUpload`, `RaceResultsPage`, `RaceResultRow`,
`AttemptCandidates`, `AttemptRequest`, `RaceEntryBlockReason`, `RaceDetail`, `TrackUpload` из `@pokatim/contracts`.

`features/races/format.ts`:
```ts
/** «1:02:05» — всегда h:mm:ss, часы без ведущего нуля и без ограничения. */
export function formatElapsed(sec: number): string;
```

`features/races/participation-format.ts` (без React; `t` из `@pokatim/i18n`):
```ts
type Result = MyRaceEntry['result'];
type Actions = MyRaceEntry['actions'];
export const ENTER_REASONS: readonly RaceEntryBlockReason[];   // cancelled, no_corridor, entries_closed, withdrawn
export const ATTEMPT_REASONS: readonly RaceEntryBlockReason[]; // cancelled, window_not_open, upload_closed, attempt_limit
/** первая причина своего действия из ответа сервера; 'unknown' — нейтрально; нет — null (F1) */
export function enterBlockReason(actions: Actions): RaceEntryBlockReason | 'unknown' | null;
export function addAttemptBlockReason(actions: Actions): RaceEntryBlockReason | 'unknown' | null;
export const blockReasonText: (reason: RaceEntryBlockReason | 'unknown') => string; // races.block.*
/** гость: коридор есть и фаза upcoming|open (условие показа кнопки входа, не права) */
export function guestCanSeeEnter(race: RaceDetail): boolean;
/** таблица: коридор есть и фаза open|closed */
export function showsResultsTable(race: RaceDetail): boolean;
export function resultPill(status: Result['status']): { label: string; tone: PillTone } | null; // withdrawn → null
/** «Ваше время»: provisional | unknown и elapsedSec !== null */
export function resultElapsed(result: Result): string | null;
export function resultBanner(result: Result, protocolDate: string):
  { tone: 'info' | 'warning'; message: string } | null;
export function attemptView(a: MyAttempt): {
  status: string; tone: PillTone; origin: string | null; source: string;
  time: string | null;   // counted: formatElapsed(segment.elapsedSec)
  best: boolean;         // counted && isBest
  detail: string | null; // rejected: races.attempt.reason.<reasons[0]>; failed: failedHint
};
/** queued|processing|unknown → uploadPending; failed|skipped|duplicate → uploadFailed {reason: uploadStatus(u).label}; ready → null */
export function pendingUploadText(u: PendingUpload): string | null;
/** queued|checking попытка, или isUploadInProgress(pendingUpload), или result.status === 'pending' */
export function needsPolling(entry: MyRaceEntry | null | undefined): boolean;
export function resultSignature(entry: MyRaceEntry | null | undefined): string | null;
/** races.error.<7 кодов слайса 03>, иначе actionErrorMessage (сеть, 429, сбой) — F5 */
export function raceActionErrorText(error: unknown): string;
export function resultRow(row: RaceResultRow, own: boolean): {
  place: string;  // tied ? races.results.tiePlace : String(place)
  who: string;    // races.results.you | races.results.rider
  time: string;   // formatElapsed
  a11y: string;   // races.results.rowA11y; ничья — races.results.tiedA11y в {place}
};
```

`features/races/queries.ts`:
```ts
export const raceEntryKey = (id: string) => ['races', 'entry', id] as const;
export const raceResultsKey = (id: string) => ['races', 'results', id] as const;      // префикс инвалидации
export const raceCandidatesKey = (id: string) => ['races', 'candidates', id] as const;
export const ENTRY_POLL_MS = 3000;
const RESULTS_PAGE_LIMIT = 50;

/** вошедшему; NOT_FOUND (старый API) → null; refetchInterval по needsPolling; staleTime 0;
 *  эффект: resultSignature изменилась (не первый ответ) → invalidate raceResultsKey (F13) */
export function useMyRaceEntry(id: string, enabled: boolean): UseQueryResult<MyRaceEntry | null>;
/** useInfiniteQuery, key [...raceResultsKey(id), 'pages'], limit 50, staleTime PUBLIC_STALE_MS, cursor = nextCursor */
export function useRaceResults(id: string, enabled: boolean);
/** no-store, staleTime 0 */
export function useAttemptCandidates(id: string, enabled: boolean): UseQueryResult<AttemptCandidates>;
/** setQueryData(raceEntryKey) ответом, затем invalidate raceResultsKey (+ raceCandidatesKey) */
async function applyEntry(queryClient: QueryClient, entry: MyRaceEntry): Promise<void>;
/** networkMode 'always' (AUTH_MUTATION); onSuccess applyEntry; onError 409 участия → invalidate raceEntryKey (F14) */
export function useEnterRace(id: string);          // mutationFn: () => enterRace
export function useWithdrawFromRace(id: string);   // mutationFn: () => withdrawFromRace
export function useAddRaceAttempt(id: string);     // mutationFn: (body: AttemptRequest) => addRaceAttempt
```
Все авторизованные вызовы — `withAccessToken((token) => api.…(token, id, …))`.

`features/devices/use-track-file-upload.ts`:
```ts
export interface TrackFileUploadOptions { onUploaded?: (upload: TrackUpload) => void }
export function useTrackFileUpload(options?: TrackFileUploadOptions): { state; choose; cancel };
```
`features/devices/upload-progress.tsx`: `UploadProgress({ name, progress, onCancel }: { name: string; progress: number; onCancel: () => void })`.

Компоненты:
```ts
RaceParticipation({ race, now, entry, signedIn, sessionPending }: {
  race: RaceDetail; now: Date | null;
  entry: UseQueryResult<MyRaceEntry | null>; signedIn: boolean; sessionPending: boolean;
});
EntryResult({ entry, race, now }); EntryActions({ entry, raceId, now });
WithdrawConfirm({ raceId, onClose }); AttemptList({ attempts, pendingUploads, now });
RaceResultsTable({ results, ownEntryId }: { results: ReturnType<typeof useRaceResults>; ownEntryId: string | null });
RacePickScreen({ id }: { id: string });
```
Оформление: «Ваше время» — `textStyle('displayNumeral36')`; время в таблице и попытках — `textStyle('time')`
(`tabularNums`); полоса своей строки — `stroke.*` + роль `theme.*` (без hex); скелетоны — `SkeletonText`/`SkeletonListRow`
в `SkeletonGroup`; строки кандидатов — `Pressable` (`accessibilityRole="button"`, `accessibilityState.disabled` у
`attempted`), из токенов.

i18n — новые ключи (`[ASSUMPTION copy]`): `races.entry.failed` «Не удалось загрузить ваше участие»;
`races.attempt.best` «Лучший»; `races.pick.attempted` «Уже в гонке»; `races.pick.empty` «Нет заездов в окне гонки»;
`races.pick.emptyHint` «Загрузите файл заезда или дождитесь импорта Garmin/Wahoo.»; `races.results.more` «Показать
ещё»; `races.results.failed` «Не удалось загрузить результаты»; `races.results.tiedA11y` «{place}-е место поровну»;
`races.results.rowA11y` «{place}, {who}, {time}». Переиспользуются: `races.result.status.withdrawn` (заголовок баннера
отмены) + `races.block.withdrawn`, `races.entry.pickRide` (заголовок экрана), `races.detail.notFound`, `state.retry`,
`state.errorTitle`/`state.failedTitle`, `tracks.source.*`, `tracks.upload.*`. `races.entry.withdrawnBanner` и
`races.pick.title` — **не** заводить.

### TESTS

Jest (jest-expo, TZ Europe/Minsk, fake timers с фиксированным `now`), `jest.mock('@/lib/api')`.

- `features/races/format.test.ts` — `formatElapsed`: 0 → «0:00:00», 59, 3600 → «1:00:00», 3725 → «1:02:05», 90061 →
  «25:01:01».
- `features/races/participation-format.test.ts` — `addAttemptBlockReason(['window_closed','upload_closed'])` →
  `upload_closed` (F1, отрицательное доказательство: `reasons[0]` дал бы `window_closed`); `enterBlockReason`
  (`['no_corridor','not_entered']`, `['unknown']`, `['not_entered']` → null); `resultPill`/`resultBanner` по всем
  статусам §7.2 вкл. `unknown`, `tied`, provisional без места; `resultElapsed` (pending → null); `attemptView`
  (counted+best, rejected с `unknown`-причиной, failed, origin `unknown`); `pendingUploadText`; `needsPolling` (каждое
  условие и «всё готово» → false); `resultSignature`; `raceActionErrorText` (7 кодов, сеть, 429, прочее); `resultRow`
  (ничья «=2», «Вы», a11y).
- `__tests__/race-participation.test.tsx` (renderRouter, `appRoutes` для гостя; вошедший — `signedInRoutes`):
  гость + коридор `upcoming|open` → «Участвовать», нажатие → `/sign-in` и `takeReturnPath() === '/races/<id>'`; гость
  без коридора / `closed` / `cancelled` → блока нет, `getMyRaceEntry` не вызывается; сессия `unknown` → блока нет (F7);
  вошедший `canEnter` → `enterRace(token, id)`, кнопка `disabled` в процессе, после ответа — блок активной заявки;
  `!canEnter` → текст причины; 409 `RACE_ENTRY_CLOSED` → текст у кнопки и повторный `getMyRaceEntry`; ошибка `entry` →
  карточка видна + баннер + «Повторить»; 404 `entry` → блока нет; `withdrawn` → баннер; `pending` → «Проверка трека»,
  «Место появится после проверки.», нет «Ваше время»; `provisional` с местом/ничьей/без места; попытки (статус,
  причина, «Лучший», `failedHint`), `pendingUploads`; **polling**: попытка `checking` → через 3 с повторный
  `getMyRaceEntry`; ответ `provisional` с местом → `getRaceResults` перезапрошен, опрос остановлен (ещё 3 с — без
  вызова), тостов/уведомлений нет; **загрузка**: выбор файла → `FakeXhr` ответ → `addRaceAttempt(token, id, { uploadId })`
  → кеш участия обновлён; pre-check отказ → баннер, `trackUploadRequest` не вызван; 409 `ATTEMPT_UPLOAD_CLOSED` на
  втором шаге → баннер с текстом; «Отменить» прогресса → без запроса попытки; **отмена участия**: «Отменить участие» →
  панель, «Оставить участие» → закрыта, `withdrawFromRace` не вызван; подтверждение → вызов, блок `withdrawn`; 409
  `RACE_WITHDRAW_CLOSED` → текст под кнопками; «Выбрать свой заезд» → `/races/pick/<id>`; `!canAddAttempt` → причина
  `upload_closed`.
- `__tests__/race-results.test.tsx` — гонка с коридором `open`: строки, «=2», «Вы» у строки с `entryId` своей заявки
  (и не у гостя), время `h:mm:ss`, «Засчитано: N», «Предварительный»; «Показать ещё» → `getRaceResults(id, { limit: 50,
  cursor })`; пусто — «Пока нет засчитанных результатов»; ошибка → баннер + «Повторить», поля карточки видны;
  `upcoming` / `cancelled` / без коридора → таблицы нет, `getRaceResults` не вызван.
- `__tests__/race-pick.test.tsx` — гость (`appRoutes`, корневой layout) → редирект на вход/регистрацию; вошедший:
  скелетон → список (дата, источник, км, длительность), `attempted` — выключен с «Уже в гонке»; нажатие →
  `addRaceAttempt(token, id, { activityId })` → возврат на `/races/<id>` (с историей — `back`, без — `replace`); пусто
  — EmptyState; «Нет соединения» / «Не удалось загрузить» + «Повторить»; ошибка мутации — баннер; невалидный id —
  «Гонка не найдена» без запроса.
- `__tests__/devices-screen.test.tsx`, `devices-step.test.tsx` — без правок ожиданий (AC12).
- `e2e/web.spec.ts` — шаг F16 (при `E2E_API=1`).
- Интеграционных (БД) нет — API не меняется.

### OUT OF SCOPE

Изменения `packages/contracts`, `packages/api-client`, `apps/api`, `apps/admin`; причины по действиям в контракте (F1
вариант c); споры, карточка соперника, Verified/кластеры, шеринг результата, статус участия в списках/Главной, карта;
фаза `final` и протокол (05); resumable-загрузка и очередь; уведомления о месте; вынос `formatElapsed`/`UploadProgress`
в `@rkarakulov/*` (один потребитель).

# 12. Outcome

**Сделано (coder, 2026-10-26)** — коммиты на `feature/race-results-04-ui` поверх spec: `3427404` (i18n, логика показа,
запросы, `UploadProgress`), `06313e9` (блок участия, таблица, экран выбора, маршрут), `2595792` (смоук web,
документация), затем коммит с этим разделом.

**Изменения по модулям**

- `packages/i18n` — 9 ключей §11 (`races.entry.failed`, `races.attempt.best`, `races.pick.{attempted,empty,emptyHint}`,
  `races.results.{more,failed,tiedA11y,rowA11y}`); `withdrawnBanner` / `pick.title` не заводились.
- `features/races/format.ts` — `formatElapsed` (h:mm:ss, часы без ограничения).
- `features/races/participation-format.ts` — чистая логика: причины по подмножеству действия (F1), показ гостя и
  таблицы, плашка / время / баннер результата, строка попытки, `pendingUploadText`, `needsPolling`, `resultSignature`,
  `raceActionErrorText` (7 кодов + `actionErrorMessage`), `resultRow`.
- `features/races/queries.ts` — ключи `raceEntryKey` / `raceResultsKey` / `raceCandidatesKey`, `useMyRaceEntry`
  (404 → `null`, опрос 3 с по `needsPolling`, тихая инвалидация таблицы по смене подписи результата),
  `useRaceResults` (infinite, 50), `useAttemptCandidates`, мутации `useEnterRace` / `useWithdrawFromRace` /
  `useAddRaceAttempt` (`AUTH_MUTATION`, `applyEntry`, 409 участия → перезапрос участия, F14).
- `features/races/participation/*` — `RaceParticipation` (состояния §7.1), `EntryResult`, `EntryActions` (загрузка в
  гонку через `useTrackFileUpload({ onUploaded })` → `addRaceAttempt({ uploadId })`), `WithdrawConfirm`, `AttemptList`.
- `features/races/results-table.tsx` — `RaceResultsTable`; `race-detail.tsx` — блоки встроены, `refetchers` расширены.
- `features/races/race-pick.tsx` + `app/races/pick/[id].tsx` — экран «Выбрать свой заезд»; `_layout.tsx` — экран под
  `Stack.Protected` вкладок.
- `features/devices` — общий `UploadProgress`, `TrackUploadBlock` на нём; хук загрузки — опция `onUploaded` (ref).
- Тесты: `__tests__/races-fixtures.ts`, `__tests__/fake-xhr.ts` (вынесен из `devices-screen.test.tsx`, ожидания не
  менялись), `app-routes.ts` (+ маршрут), дефолтные моки в `race-detail.test.tsx` / `season.test.tsx` (F15, D6).

**Тесты (новые):** `format.test.ts` (+6), `participation-format.test.ts` (42; F1-регресс
`['window_closed','upload_closed']` → `upload_closed` с отрицательным доказательством `reasons[0]`),
`race-participation.test.tsx` (29: гость, F7, F8; заявка, 409 и перезапрос; ошибка и 404 участия; `withdrawn`;
`pending` / `provisional` / ничья / без места; попытки и загрузки; F1; переход на выбор; **polling** — повтор через 3 с,
перезапрос таблицы, остановка опроса, без `alert`; **загрузка** — прогресс, `{ uploadId }`, pre-check, 409 второго
шага, «Отменить»; **отмена** — «Оставить», подтверждение, 409), `race-results.test.tsx` (9), `race-pick.test.tsx` (10:
гард гостя, скелетон, список и выключенный, выбор с историей и без, ошибка мутации, пусто, сеть / сбой с повтором,
невалидный id).

**Документация:** `docs/product/races-and-seasons.md` («Участие и результат» — экраны слайса 04, D1/D2), эпик §7
(пометка D1/D2), `.claude/rules/pokatim-app.md` (раздел race-results-04). ADR не нужен.

**Проверки**

- `TURBO_CONCURRENCY=1 pnpm check` (Node 24.22.1, `MONGO_URL_TEST=…/pokatim_r04ui_test`, `REDIS_URL_TEST=…/11`) →
  exit 0: `Tasks: 13 successful, 13 total` (`Cached: 5`), `@pokatim/app:test: Test Suites: 93 passed, 93 total`,
  `Tests: 816 passed, 816 total`.
- `devices-screen.test.tsx`, `devices-step.test.tsx` — зелёные без правок ожиданий (AC12).
- `e2e/web.spec.ts` — шаг F16 в тесте «Гонки и сезон (блок 03)»: гость видит «Участвовать» и «Войдите, чтобы
  участвовать» на гонке с коридором, без коридора — нет; вошедший на `/races/pick/<id>` — заголовок и пустое
  состояние. **NOT VERIFIED:** `E2E_API=1 pnpm e2e:web` не запускался (нужны API, worker, Mailpit и web-сборка).
- Ручная проверка на iOS / Android-симуляторе и в браузере — **NOT VERIFIED**.

**Fix pass 1** (`72c7f2e`, findings.md): отмена устаревшего опроса до записи ответа мутации, текст отказа отмены после
перезапроса, прогресс отправки вне `canAddAttempt`, своя причина важнее `unknown`, фокус скринридера на заголовок
подтверждения (`lib/accessibility-focus(.web).ts`), полоса своей строки — `stroke.indicator` + `border.strong`.
`pnpm check` → exit 0, `Tests: 822 passed`.

**Follow-ups и риски**

- Ответ мутации меняет подпись результата в кеше — эффект `useMyRaceEntry` может инвалидировать таблицу второй раз
  (лишний публичный запрос, на показ не влияет).
- В системе нет акцентной роли рамки — полоса своей строки таблицы на `border.strong` (кандидат в app-foundation).
- `TextAction` без `loading` / `busy` — кандидат в app-foundation (D4).
- `formatElapsed`, `UploadProgress` — кандидаты в общий код при втором потребителе (панель, слайс 05).
