# Findings — race-results-08c (приложение) — pass 1 — reviewer: claude
base: 064765e   commits: 064765e...1800958
verdict: APPROVE

Проверено: diff 08c целиком, вызовы (`season-detail.tsx`, `(tabs)/races.tsx`, `settings/profile.tsx`,
`results-table.tsx`, `useHeaderSeason`, `queryClient.clear()` в `app/_layout.tsx` и `use-sign-out.ts`,
`api-client` `getPublic`). Таргетные тесты (`season-standings`, `profile-season-block`, `season`,
`features/standings`) — `Test Suites: 4 passed`, `Tests: 50 passed`.

Измерения без замечаний: серверный авторитет (очки, места, N/M, `counted` — только из ответа); безопасность (`/me` —
`withAccessToken`, `enabled: signedIn`, в SSR не запрашивается — у `useQuery` нет fetch на сервере; кэш стирается
`queryClient.clear()` при выходе); ключи под `['seasons','standings',id]` не пересекаются с `['seasons','detail'|
'races'|'list'|'current']`; RC-11 («Вы» только при равном `computedAt`, `ownOrder`); «Курсор и снимок» (`mixed` →
`resetQueries` exact, тест есть); RC-12 (пустая таблица без ошибки); RC-17 («Показать ещё», не `onEndReached`); RC-18
(`useHeaderSeason`); S11 («DQ · 0», статус — серверный `counted`); дизайн-система (только `@rkarakulov/ui`, роли
`useTheme()`, токены; hex/rgba/`Platform.OS` нет; «Вы» — текстом и полосой, не только цветом); i18n (плюрали note /
caption / points корректны для one/few/many/other); состояния (скелетон, ошибка сводки — `AsyncContent`, таблицы и
профиля — `TabFailure` с повтором и «Нет соединения» при паузе, ошибка обновления не прячет данные); web — тот же код,
SSR экрана не тронут; миграций, очередей, аудита в 08c нет; Documentation Sync — `races-and-seasons.md`,
`pokatim-app.md` обновлены, отклонения записаны в §12.3.

### [MEDIUM] Повтор при RC-11 и сброс «Курсор и снимок» упираются в HTTP-кэш `public, max-age=60`
- **file:** apps/app/src/features/standings/season-standings.tsx; apps/app/src/features/standings/queries.ts
- **location:** season-standings.tsx:143-160 (`useSnapshotSync`); queries.ts:73-78 (`mixed` → `resetQueries`)
- **problem:** RC-11 срабатывает, когда таблица старше `/me`, то есть таблица пришла из кэша `max-age=60`.
  `refetchTable()` — это тот же GET на тот же URL: на web (кэш браузера) и, вероятно, на iOS (`NSURLCache`) он
  вернёт тот же устаревший ответ из HTTP-кэша. `synced.current` блокирует повтор для этой пары, поэтому «Вы» не
  появится, пока не сработает pull-to-refresh, фокус или повторное открытие экрана после истечения 60 с. Та же
  асимметрия есть у сброса по курсору: первая страница (URL без `cursor`) может прийти из HTTP-кэша со старым
  снимком, а страница по курсору (новый URL) — со свежим. Тогда в этом окне каждое «Показать ещё» схлопывает таблицу
  обратно до первой страницы.
- **why_it_matters:** механизм RC-11 рассчитан именно на окно расхождения кэшей, но в этом окне он ничего не меняет.
  Тесты мокают `api` и HTTP-кэш не видят. Данные не портятся: метка просто не ставится, а не ставится на чужую
  строку. Поэтому это не блокер.
- **evidence:** `packages/api-client/src/index.ts:204-205` — `requestPublic(path, schema, { method: 'GET',
  ...withCredentials })` без `cache`; `useSnapshotSync`: `if (synced.current === pair) return;`.
- **recommended_fix:** проверить на web/iOS. Если подтвердится — для повтора RC-11 и сброса снимка обходить
  HTTP-кэш (например, `cache: 'no-cache'` для повторного запроса таблицы в api-client — это отдельный параметр, без
  смены контракта). Другой вариант — повтор с задержкой до истечения `max-age` вместо одноразового. Как минимум
  записать ограничение в §12.3 / follow-ups.

### [LOW] Ключ i18n `profile.season.line` не используется
- **file:** packages/i18n/src/ru.ts
- **location:** :547
- **problem:** подпись «{группа} · {класс}» в профиле берётся из `season.standings.table` (`tableLabel`), а
  `profile.season.line` нигде не читается.
- **why_it_matters:** мёртвый текст в словаре расходится с кодом при правках.
- **evidence:** `grep -rn "profile.season.line" apps packages` — совпадение только в `ru.ts`.
- **recommended_fix:** удалить ключ или использовать его в `profile-season-block.tsx`.

### [LOW] «Профиль»: пустая секция и мигание блока у райдера без строк
- **file:** apps/app/src/app/settings/profile.tsx; apps/app/src/features/standings/profile-season-block.tsx
- **location:** profile.tsx:72-75; profile-season-block.tsx:91-97, 116-119
- **problem:** обёртка `<View style={styles.section}>` (отступ `paddingTop: size.sectionGap` плюс `gap` контейнера)
  остаётся и когда `ProfileSeasonBlock` возвращает `null`, поэтому между блоками появляется лишний отступ. Пока `/me`
  грузится, показываются заголовок «Сезон» и скелетон, а у большинства райдеров (строк нет) блок потом исчезает, и
  раскладка прыгает.
- **why_it_matters:** косметика и скачок раскладки на каждом открытии «Профиля» для пользователей без результатов.
- **evidence:** `<View style={styles.section}><ProfileSeasonBlock /></View>`;
  `if (me.data !== undefined && me.data.items.length === 0) return null;`.
- **recommended_fix:** перенести отступ секции внутрь `ProfileSeasonBlock` (рендерить обёртку только с
  содержимым). Мигание можно оставить: §4.12 требует скелетон, а решение «скрыт без строк» — продуктовое.

### [LOW] Пробелы в тестах состояний и RC-11
- **file:** apps/app/src/__tests__/season-standings.test.tsx
- **location:** describe «таблица сезона на экране сезона (08c)»
- **problem:** не покрыты: обратное направление RC-11 (таблица новее `/me` → ровно один перезапрос `/me`, таблица
  не перезапрашивается); пауза без сети (`fetchStatus: 'paused'` → «Нет соединения», вошедший не висит на скелетоне
  из-за `meSettled`); ошибка обновления при наличии данных (строки остаются, баннер с повтором).
- **why_it_matters:** ветка `else void refetchMe()` и `me.fetchStatus === 'paused'` в `meSettled` — логика без
  доказательства; §4.12 требует нет сети и ошибку обновления.
- **evidence:** season-standings.tsx:157-158, :183; тест RC-11 есть только для `/me` новее таблицы (:155-175).
- **recommended_fix:** добавить два-три теста по образцу существующих (`onlineManager.setOnline(false)`, мок
  `getMine` со старым `computedAt`, `mockRejectedValueOnce` на refetch).
