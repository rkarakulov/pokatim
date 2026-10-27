# Findings — race-results-07c — pass 1 — reviewer: claude
base: origin/develop (c31d9a3)   commits: origin/develop...f19c49b (8867932 + merge)
verdict: APPROVE

Проверено по измерениям контракта: correctness, call sites (race-detail, rival-card, dispute-form, маршруты
`result`/`dispute`), RC-11 (`group` только при непустом `groups`; финишёры — только при `finishers > 0`), DV-1/DV-8
(выбор уровня только при `gender_age` + `verified`, групп в клиенте не считаем), ошибки 409/422/400 по кодам
(`races.error.*`, `profile.verified.error.*`, поля — `serverFieldErrors`), ПДн (в URL только `?race=<uuid>`, логов нет,
кэш анкеты стирается `queryClient.clear()` при выходе), дизайн-система (только `@rkarakulov/ui` и токены; hex/px и
`Platform.OS` в изменённых файлах нет), состояния §4.12 (скелетон, ошибка с повтором и пусто — для каждой вкладки и
анкеты; данные при ошибке обновления не прячутся; кнопки мутаций — `loading`), i18n (формальное «вы»), тесты
(поведенческие, через `renderRouter` и моки api, не тавтологии). Тесты не запускались (по заданию) — NOT VERIFIED;
визуальная проверка `SegmentedControl` внутри горизонтального `ScrollView` на iOS/Android/web — NOT VERIFIED.

### [MEDIUM] После 409 VERIFIED_DEMOGRAPHICS_LOCKED форма продолжает слать изменённые пол/год — повторное сохранение снова 409
- **file:** apps/app/src/features/profile/verified-profile-form.tsx
- **location:** `useForm({ defaultValues: valuesOf(view) })` (стр. 121–125), ветка 409 (стр. 147–151), `locked` (стр. 127)
- **problem:** на 409 анкета перезапрашивается, `view` приходит с `demographicsLocked: true`, и экран переключается на
  блок «только чтение» (это проверяет тест). Но состояние формы не сбрасывается: `defaultValues` берутся только при
  монтировании, `AsyncContent` не перемонтирует `VerifiedProfileFormView`, а react-hook-form по умолчанию
  (`shouldUnregister: false`) сохраняет значения размонтированных `gender`/`birthYear`. Следующее «Сохранить» (например,
  после правки веса) отправит в PUT уже скрытые изменённые пол/год → снова 409. Выйти из цикла можно только уходом с
  экрана. Тот же сценарий срабатывает, если анкета открыта из кэша (`DEFAULT_STALE_MS` 10 с), а после
  Verified-заявки `VERIFIED_PROFILE_KEY` не инвалидируется (`applyEntry` трогает только участие, таблицу и кандидатов):
  поля пола и года выглядят редактируемыми, хотя уже зафиксированы.
- **why_it_matters:** §11.3 и §12.3 требуют «409 — баннер и перезапрос анкеты» с переходом в режим «только чтение».
  Сейчас пол и год показаны только для чтения, а запрос несёт другие значения, и экран остаётся без выхода. Тест
  `409 VERIFIED_DEMOGRAPHICS_LOCKED …` повторное сохранение не проверяет.
- **evidence:** в тесте (`verified-profile.test.tsx:240–262`) выбирается «Женский», затем 409; утверждается только текст
  блокировки. В форме нет `form.reset`/`resetField` на смену `view` и нет `key` у `VerifiedProfileFormView` в
  `app/settings/verified.tsx`.
- **recommended_fix:** при `view.demographicsLocked` (или в ветке 409 после refetch) сбрасывать `gender`/`birthYear`
  к значениям сервера: `useEffect` на `view` с `form.resetField(..., { defaultValue })` либо
  `key={String(data.demographicsLocked)}` на `VerifiedProfileFormView`, чтобы форма перемонтировалась. Ещё надёжнее —
  в locked-режиме брать пол и год для PUT из `view.profile`, а не из формы. Добавить в тест повторное «Сохранить»
  после 409 и проверить тело (пол прежний). По желанию — инвалидировать `VERIFIED_PROFILE_KEY` после успешной
  Verified-заявки или повышения.

### [MEDIUM] Pull-to-refresh карточки гонки не обновляет вкладку группы и «Финишёры»
- **file:** apps/app/src/features/races/race-detail.tsx; apps/app/src/features/races/results-table.tsx
- **location:** `refetchers` (race-detail.tsx ~стр. 210–229); `groupResults`/`finishers` внутри `RaceResultsTable`
- **problem:** при обновлении жестом перезапрашивается только `results.refetch` (таблица группы по умолчанию). Запросы
  вкладки не по умолчанию (`[…,'pages',group]`) и финишёров (`[…,'finishers']`) создаются внутри `RaceResultsTable` и
  в список не попадают. Пользователь на вкладке «Женщины до 40» или «Финишёры» тянет экран, индикатор отрабатывает, а
  строки остаются прежними (`PUBLIC_STALE_MS` 60 с). Если своя группа отличается от группы по умолчанию, это
  вкладка по умолчанию для участника, и он упирается в эту проблему сразу.
- **why_it_matters:** до 07c pull-to-refresh обновлял единственную видимую таблицу. С вкладками жест молча
  перестал обновлять то, что на экране (регрессия поведения §4.12 «обновление»).
- **evidence:** `...(tableShown ? [results.refetch] : [])` — единственный refetch таблицы; `useRaceResults(raceId,
  group !== undefined, group)` и `useRaceFinishers` живут только в `results-table.tsx`.
- **recommended_fix:** добавить в `refetchers` `queryClient.invalidateQueries({ queryKey: raceResultsKey(id) })`
  (префикс накрывает все вкладки и финишёров; активные запросы перезапросятся) вместо `results.refetch` или вместе с
  ним. Добавить тест: вкладка не по умолчанию + refresh → повторный `getRaceResults` с `group`.

### [LOW] TierPicker: пока идёт заявка одного уровня, кнопка другого остаётся активной
- **file:** apps/app/src/features/races/participation/tier-picker.tsx
- **location:** `TierPicker`: `pendingTier`, `loading` у кнопок Verified/START
- **problem:** `loading` выставляется только у нажатой кнопки, вторая остаётся нажимаемой. Можно отправить параллельно
  `{tier:'verified'}` и `{tier:'start'}`. Результат зависит от порядка на сервере: либо 409 `RACE_TIER_LOCKED`, либо
  START, который тут же повышается до Verified.
- **why_it_matters:** §4.12, состояние кнопки при мутации; неоднозначный исход для пользователя.
- **evidence:** `loading={pendingTier === 'start'}` / `pending={pendingTier === 'verified'}`, `disabled` не задан.
- **recommended_fix:** `disabled={enter.isPending}` у обеих кнопок (в `VerifiedChoice` передать `disabled`).

### [LOW] Locked-анкета с незнакомым полом (`unknown`) — «Сохранить» молча ничего не делает
- **file:** apps/app/src/features/profile/verified-profile-form.tsx
- **location:** `valuesOf` (`gender: profile.gender === 'unknown' ? '' : …`), ошибка `gender` выводится только в ветке без блокировки
- **problem:** если сервер новее и прислал незнакомый пол, а анкета заблокирована, локальная валидация падает на
  скрытом поле `gender`, и пользователь не видит ни ошибки, ни запроса.
- **why_it_matters:** редкий случай, но экран зависает без обратной связи.
- **evidence:** `{errors.gender ? … : null}` есть только в ветке `!locked`.
- **recommended_fix:** в locked-режиме не валидировать и не слать значения из формы (брать из `view.profile`) или
  показать общий баннер ошибки.

### [LOW] VERIFIED_PROFILE_REQUIRED при заявке не переводит к анкете (отклонение от §11.3 без записи)
- **file:** apps/app/src/features/races/participation/tier-picker.tsx
- **location:** `TierPicker`, `enter.error`
- **problem:** §11.3: «`VERIFIED_PROFILE_REQUIRED` → переход к анкете». Реализация показывает баннер и перезапрашивает
  участие, после чего блок сам предлагает «Заполнить анкету». Поведение разумное, но в §8.2 не записано как
  отклонение.
- **why_it_matters:** Documentation Sync / соответствие spec.
- **evidence:** `onError` в `useEntryMutation` только инвалидирует `raceEntryKey`; навигации нет.
- **recommended_fix:** записать отклонение в §12.3/§8.2 или выполнять `router.push(verifiedProfilePath(raceId))` по этому
  коду.

### [LOW] epic.md не отражает статус 07c
- **file:** docs/tasks/2026-10-27-race-results/epic.md
- **location:** строка таблицы слайса 07 (стр. ~256)
- **problem:** там по-прежнему «07a … реализовано, 07b (панель), 07c (приложение)»; раздел 10 task.md требует статус
  слайса 07 в epic.
- **why_it_matters:** Documentation Sync.
- **evidence:** `git diff origin/develop...HEAD -- docs/tasks/2026-10-27-race-results/epic.md` — пусто.
- **recommended_fix:** отметить 07c (и 07b, если она слита) реализованными.

Итог: CRITICAL/HIGH нет → APPROVE. До merge рекомендуется закрыть оба MEDIUM: цикл 409 в анкете и refresh вкладок.
