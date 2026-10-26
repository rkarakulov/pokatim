---
paths:
  - "apps/admin/**"
---

# pokatim — веб-панель «Протокол» (дополняет `web.md`)

Процесс — скил `app-dev-kit:web-ui`. Гостевой веб — не здесь: это то же приложение `apps/app` (ADR-0003,
`pokatim-app.md`).

## admin — панель «Протокол» (тема `panel`)

- Desktop 1440, только светлая тема, плотные таблицы (TanStack Table): сортировка, фильтры, вкладки кластеров,
  фиксированная шапка.
- Доступ по роли (организатор / модератор / админ); без роли — экран «Нет доступа».
- Формы — react-hook-form + zod; данные — `@pokatim/api-client`. Исключение — панель решения спора (радио и
  необязательная заметка, `useState`; тело проверяет схема контракта на сервере).
- Деструктивные и необратимые действия (исключение трека, пересчёт, публикация протокола) — модалка с обязательной
  причиной; причина уходит в append-only аудит на сервере. Решение спора — обязательный шаблон исхода в форме и
  `Dialog` подтверждения без свободной причины (журнал пишет заметку или код шаблона, раздел «Споры»).
- Чек-лист публикации протокола блокирует кнопку и объясняет почему.
- Флаги правдоподобия видны только команде платформы и не блокируют публикацию.
- Биометрия (пульс, мощность, FTP, вес) — только в разборе спора: блок `DisputeSeries` (06b) — запрос по кнопке,
  опрос `preparing` каждые 2 с не дольше 3 мин, `gcTime: 0`; графики — `SeriesChart` (inline SVG, без библиотеки
  графиков: один ряд на график, общая ось дистанции, шкала Y — мин/макс текстом, перекрестие мышью; картинка без
  фокуса), клавиатурный и экранный доступ к значениям — таблица в `<details>`.

## Каркас, сессия и права (admin-01, ADR-0009)

- Роутер — TanStack Router (`src/router.tsx`, `basepath` из `import.meta.env.BASE_URL`); защищённая ветка —
  `beforeLoad` с `ensureQueryData(meQuery)`; «кто я» — `src/session/me.ts`. Глобальные 401/403 — `createQueryClient`
  (`src/session/query-client.ts`): 401 после входа — «Вход» с «Сессия истекла» и `next` (только путь внутри панели —
  `safeNext`), 403 — «Нет доступа к разделу». Мутация, сама обрабатывающая 401 (вход), — `meta.ownsUnauthorized`.
- Права в UI — только отображение: `Can` / `useCan(permission)`; раздел с правом — `RequirePermission` в маршруте
  (прямой URL без права — «Нет доступа к разделу» внутри каркаса). Источник истины — `PanelGuard` сервера.
- Навигация — один файл `src/navigation.ts` (`{ to, labelKey, permission?, group }`).
- Новые экраны — только из `src/ui` (`AppShell`, `PageHeader`, `DataTable`, `Dialog`, `ReasonDialog`, поля, `Button`,
  `Banner`, `StatusTag`, `AuthCard`, `EmptyState`, `ErrorState`): без доменных импортов, кандидаты в
  `@rkarakulov/admin-kit` (F6, явное исключение `AGENTS.md` §4.11 до выноса). Размеры раскладки панели, которых нет в
  базе, — `src/panel-tokens.ts` (`--panel-*`, временно до токенов базы, Q17).
- Время — `src/format.ts` (`Intl` ru-RU, Europe/Minsk); тесты admin — `TZ=Europe/Minsk` (`vite.config.ts`).
- CSP панели — `infra/docker/admin-nginx.conf`: inline-скриптов нет, inline — только `<style>` дизайн-системы.
- Ввод даты и времени — `DateTimeField`/`DateField` (`src/ui`): значение — настенное время Europe/Minsk, в запрос —
  `minskWallTimeToUtc` контрактов (не `new Date(value)`); показ — `src/format.ts`.
- Что можно менять в записи — `editable` сервера (`PanelRace.editable`): зафиксированные поля — с замком, причина
  недоступности — `DisabledReason` под кнопкой (`aria-disabled` + `aria-describedby`). Правила (48 ч, «только позже»,
  пересечение сезонов) в UI — только подсказка.
- Поле «Эталонный коридор» (race-results-01) — `features/races/CorridorField.tsx`: готовые маршруты
  (`readyRoutesQuery` — все страницы курсора без предела; повтор курсора — ошибка, не «полный» список), «Загрузить GPX» — `FileButton` → окно «Новый маршрут» (без вложенной
  `<form>`: окно внутри формы гонки) → опрос `routeQuery` каждые 2 с, пока `processing`, не дольше 5 мин по часам — и при сплошных ошибках запросов (дальше —
  «проверьте позже»; статус — `role="status"`, без спиннера; три сбоя подряд — баннер), отказ — причина под полем.
  Ошибка обновления превью при показанной линии — баннер с повтором.
  Превью — `LinePreview` (SVG без карты: `--color-map-route`, `--stroke-indicator`). С коридором дистанция — только
  чтение («… — по маршруту»), допуск — поле с подсказкой «Коридор: ±N м от маршрута». Ошибки сервера
  `corridor.routeId` / `corridor.widthM` — под своими полями формы.
- 409 `CONFLICT` правки по устаревшей версии — `ConflictBanner` «Запись изменили — обновите страницу» с «Обновить».
- Раздел «Результаты» гонки (race-results-05) — `features/results/` по маршруту `races/$raceId/results`
  (`races.read`), ссылка «Результаты» из `RaceEditor` опубликованной или отменённой гонки. KPI — `StatTile` (`src/ui`).
  Чек-лист публикации — только из `PanelRaceResults.publish` (на клиенте не считается): «Опубликовать протокол»
  неактивна с первой причиной и количеством (`DisabledReason`). Все действия — `ReasonDialog` с обязательной
  причиной; затем инвалидация ключа гонки (`['admin','races','item',id]` — результаты лежат под ним), 409 — тоже.
  Ошибки `RESULTS_ACTION_BLOCKED` / `RESULTS_PUBLISH_BLOCKED` — текст по `details` (`results-errors.ts`). Действия
  скрывают права `results.manage` / `results.revise`; места, статусы и ревизии — только с сервера.
  Подпись участника — `riderLabel(entryId, riderName)`: «Анна К. ·id» при имени (сервер отдаёт его только с
  согласием), иначе «Участник ·id» (profile-02). «Сбросить имя» в «Участниках» — только с `profiles.moderate` и при
  имени, `ReasonDialog` с предупреждением не писать имя в причину.
- «Модерация райдов» (05b) — `features/rides-moderation/*`, маршруты `/rides-moderation` (`?state=hidden` — в URL) и
  `/rides-moderation/$rideId` под `RequirePermission permission="rides.moderate"`, пункт навигации — группа `bottom`
  в конце. Действия — `ReasonDialog`; 409 `CONFLICT` и `RIDE_INVALID_STATE` — `ConflictBanner` с перечитыванием
  карточки; «Отклонить жалобы» отправляет `lastReportAt` карточки.
- «Споры» (race-results-06) — `features/disputes/*`, маршруты `/disputes` (`?status=`, `?raceId=` — в URL) и
  `/disputes/$disputeId` под `RequirePermission permission="disputes.read"`; пункт навигации — группа `main` после
  «Гонок». Список: `ChipGroup` статуса (по умолчанию «На рассмотрении»), фильтр гонки — текст «Гонка: {название}» и
  «Все гонки» (выбора гонки нет), курсор. Разбор: категория в заголовке, статус справа; результат, заявление
  («Скрыт от участника»), ответ, история — только с сервера. `DecisionPanel` (`disputes.decide`) — форма на
  `useState` (исход, шаблон из карты исхода — обязателен, заметка), кнопка `aria-disabled` + `DisabledReason` по
  `decideBlockedBy` (D-25 — с датой `availableAt`), подтверждение — `Dialog`; `ReasonDialog` не используется. После
  решения — инвалидация `['admin','disputes']`, ключа гонки и журнала. Чек-лист «Результатов»: строка
  `open_disputes` — ссылка «Открыть споры» (`/disputes?raceId=`) при `count > 0` и `disputes.read`;
  `RecalculationsList` — запись `dispute:<id>` ссылкой на спор; `RaceEditor` — причина `disputes_open` (D-19).

## Проверка

`pnpm --filter @pokatim/admin build` и `pnpm check`; смоук — `pnpm e2e:admin` (`docs/runbooks/local-dev.md`,
«Панель»).
