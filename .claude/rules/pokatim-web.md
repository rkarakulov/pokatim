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
- Формы — react-hook-form + zod; данные — `@pokatim/api-client`.
- Деструктивные и необратимые действия (исключение трека, решение спора, пересчёт, публикация протокола) — модалка
  с обязательной причиной; причина уходит в append-only аудит на сервере.
- Чек-лист публикации протокола блокирует кнопку и объясняет почему.
- Флаги правдоподобия видны только команде платформы и не блокируют публикацию.
- Биометрия (пульс, мощность, FTP, вес) — только в разборе спора (графики HR/мощности по дистанции).

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
- «Модерация райдов» (05b) — `features/rides-moderation/*`, маршруты `/rides-moderation` (`?state=hidden` — в URL) и
  `/rides-moderation/$rideId` под `RequirePermission permission="rides.moderate"`, пункт навигации — группа `bottom`
  в конце. Действия — `ReasonDialog`; 409 `CONFLICT` и `RIDE_INVALID_STATE` — `ConflictBanner` с перечитыванием
  карточки; «Отклонить жалобы» отправляет `lastReportAt` карточки.

## Проверка

`pnpm --filter @pokatim/admin build` и `pnpm check`; смоук — `pnpm e2e:admin` (`docs/runbooks/local-dev.md`,
«Панель»).
