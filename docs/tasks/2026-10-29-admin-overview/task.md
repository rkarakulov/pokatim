# task: admin-overview — раздел «Обзор» панели

Уровень: task3 (несколько модулей API, контракт, право, миграция индексов, экран панели). Ветка `feature/admin-overview`
от `origin/develop`, один PR в `develop`.

## 1. Title

«Обзор» панели «Протокол»: требует внимания, сейчас идёт, KPI (admin), статус API.

## 2. Goal

Сотрудник открывает панель и сразу видит, где нужна работа (очереди модерации, споры, протоколы), что идёт сейчас и —
админ — пульс платформы. Сейчас «Обзор» — заглушка (статус API + пустое состояние).

## 3. Scope

Структура согласована с пользователем (сессия-родитель, 2026-10-29):

1. **Требует внимания** — карточки-счётчики со ссылкой в раздел, каждая только при праве:
   - открытые споры — `disputes.read` → `/disputes`;
   - гонки, ждущие публикации протокола (фаза `closed`), из них готовы к публикации, и число блокеров чек-листа —
     `races.read` (организатор — только свои) → `/races`;
   - кофе-райды с открытыми жалобами — `rides.moderate` → `/rides-moderation`;
   - «Маршруты райдеров»: заявки в каталог и маршруты с жалобами — `routes.moderate` → `/rider-routes`;
   - профили с открытыми жалобами — `profiles.moderate` → `/rider-profiles`;
   - зависшие удаления аккаунтов — `platform.stats` (новое право, только admin), без ссылки (раздела нет).
   Ноль — спокойное состояние («Всё разобрано»), не ошибка.
2. **Сейчас идёт** (`races.read`) — гонки с открытым окном (участники, загруженные попытки; ссылка в результаты
   гонки), организатор — только свои; ближайшие старты календаря (5).
3. **KPI** (`platform.stats`, только admin) — новые пользователи за 7 дней, загрузки файлов за 7 дней, активные
   (предстоящие опубликованные) кофе-райды. Визуально — KPI strip (`.stat-tiles` / `StatTile`).
4. Статус API — внизу.

## 4. Out of Scope

- Экран сбоев удаления аккаунтов и разбор failed-задач BullMQ (follow-up F13 в `pokatim-backend.md`).
- Графики, тренды, сравнение с прошлой неделей.
- Автообновление чаще обычного refetch TanStack Query (polling не вводим).

## 5. Architecture Context

- `GET /v1/admin/overview` — новый модуль-композиция `modules/overview` (как `riders`/`standings`): его не импортирует
  никто, кроме `AppModule`. В `panel` класть нельзя — `panel/index.ts` импортируют все модули панели (цикл).
- Контроллер под `PanelGuard` без `RequirePermission` («Обзор» видят все роли); блоки режет сервис по
  `principal.permissions`. Блок без права не отдаётся (поле отсутствует), не `0`.
- Счётчики — порты модулей-владельцев (`AGENTS.md` §4.3), чужие коллекции не читаем.

## 5.1 Placement & Reuse Gate

| Счётчик | Владелец | Порт (новый) | Фильтр / индекс |
|---|---|---|---|
| открытые споры | disputes | `DISPUTES_OVERVIEW.openCount()` | `{status:'open'}`, `disputes_queue_idx` |
| ждут протокола, открытые окна | races | `RACES_OVERVIEW.awaitingProtocol / openWindow(principal, now)` | `ownScope`/`ownerUserId`; `races_public_past_idx`, `races_public_current_idx` |
| блокеры, участники, попытки | results | `RESULTS_OVERVIEW.protocolReadiness(races, now)`, `activity(raceIds)` | reuse `ResultsPanelReadService.checks` + `publishChecklist`; агрегаты по `race_entries_race_idx`, `race_attempts_race_status_idx` |
| райды с жалобами, активные райды | rides | `RIDES_OVERVIEW.reportedCount()`, `upcomingCount(now)` | `rides_report_queue_idx` (partial), `rides_feed_idx` |
| заявки и жалобы маршрутов | routes | `ROUTES_OVERVIEW.moderationCounts()` | фильтры `listPublicationQueue`, partial-индексы 0029 |
| профили с жалобами | profile | `PROFILES_OVERVIEW.reportedCount()` | `profiles_report_queue_idx` |
| новые пользователи, зависшие удаления | identity | `IDENTITY_OVERVIEW.createdSince(since)`, `stuckDeletions(deletedBefore)` | **новый** `users_created_at_idx`; `users_erasure_pending_idx` |
| загрузки за 7 дней | tracks | `TRACKS_OVERVIEW.uploadsSince(since)` | **новый** `track_uploads_created_at_idx` |
| ближайшие старты | calendar | `CALENDAR_OVERVIEW.upcoming(from, limit)` | reuse `CalendarRepository.listPublic` |

Reuse: `racePhase`/`ownScope` (races.policy), `publishChecklist` (results.policy), `minskToday`, `StatTile`,
`ErrorState`, `PageHeader`. Дубли запрещены: свой расчёт фазы гонки или чек-листа в overview.

## 6. Relevant Files

`packages/contracts/src/admin/overview.schema.ts` (новый), `permissions.schema.ts`; `packages/api-client/src/admin.ts`;
`apps/api/src/modules/overview/*` (новый), порты в `{disputes,races,results,rides,routes,profile,identity,tracks,calendar}`;
`apps/api/src/db/migrations/0036_overview_indexes.ts`; `apps/admin/src/features/overview/*`; `packages/i18n`;
`docs/product/admin-panel.md`.

## 7. Implementation Notes

- «Зависшее удаление» — `deletedAt` старше 24 ч без `erasureSweptAt`: штатно повторный проход идёт через 15 мин, регламент
  resume — каждый час; сутки без завершения = очистка падает. Это прокси сбоя без доступа API к Redis/BullMQ.
- «Загрузка» — документ `track_uploads` (файл заезда райдера или импорт агрегатора Garmin/Wahoo), `createdAt >= now − 7 сут`.
- «Новый пользователь» — подтверждённый и не удалённый аккаунт, созданный за 7 сут.
- «Активный райд» — `published` и `startsAt > now` (фаза `upcoming`, как лента).
- Гонок с открытым окном и ждущих протокола — не больше 20 (лимит на запрос; гонок мало, лимит — защита). Готовность
  протоколов — по 20 недавно закрывшимся (`checked`), «ждут» — по всем; `checked < awaiting` — подсказка «по N последним».
- Право `platform.stats` добавляется в конец `PERMISSIONS`; admin получает автоматически (`PERMISSIONS` целиком).

## 8. Risks / Assumptions / Open Questions

- [ASSUMPTION] «Число блокеров» = сумма невыполненных пунктов чек-листа публикации по ждущим гонкам (пункт `window_open`
  тоже блокер — сутки приёма после окна).
- [ASSUMPTION] Ближайшие старты календаря видят все роли (публичные данные).
- Миграция 0035 занята сессией «Достижения» — у нас 0036; перед мержем сверить номер с `develop`.
- Чек-лист — ~5 запросов на гонку; при лимите 20 гонок приемлемо для экрана сотрудника.

## 8.1 Requirements Consistency

Права — по `docs/product/admin-panel.md` и `permissions.ts`: организатор видит только блоки гонок (свои);
модератор — споры, все гонки, очереди модерации; admin — всё + KPI.

## 9. Acceptance Criteria

1. `GET /v1/admin/overview` без сессии — 401; организатор получает только `attention.protocols` и `live` по своим
   гонкам; модератор — все блоки, кроме `kpi` и `attention.accountDeletions`; admin — все.
2. Счётчики совпадают с очередями разделов (те же фильтры).
3. Панель: карточки только при праве (сервер не отдал — не рисуем), ноль — спокойная формулировка, ссылка в раздел.
4. Загрузка — скелетоны на месте значений, заголовки видны; ошибка без данных — `ErrorState` с повтором; ошибка
   обновления — данные остаются + баннер (§4.12).
5. Статус API внизу экрана, тесты статуса не сломаны.
6. `pnpm check` зелёный; миграция идемпотентна.

## 10. Documentation Impact

`docs/product/admin-panel.md`: право `platform.stats`, описание «Обзора», карта разделов.

## 11. Implementation Context

Фаза: FINISH. Base: `origin/develop` 3d2b6fe.

## 12. Outcome

- API: модуль `overview` (`GET /v1/admin/overview`), порты-классы в 9 модулях-владельцах, право `platform.stats`
  (admin), миграция `0036_overview_indexes` (`users_created_at_idx`, `track_uploads_created_at_idx`). Рефакторинг без
  смены поведения: фильтры очередей маршрутов (`publicationQueueFilter`) и зависших удалений (`pendingSweepFilter`)
  вынесены для общего списка и счётчика; `CalendarRepository` — в новый `CalendarCoreModule`.
- Панель: «Требует внимания» (`StatTile`, ссылки в разделы, ноль — «Всё разобрано»), «Сейчас идёт» (`DataTable`),
  «Платформа» (KPI strip), статус API внизу; скелетоны по правам сессии, `ErrorState`, баннер обновления.
- Тесты: int `apps/api/test/overview.int.test.ts` (роли и набор ключей, свои/чужие гонки, фазы, блокеры, фильтры
  очередей с отрицательными случаями, KPI, календарь), миграции, `admin-routes`; экран — 12 тестов; контракт и клиент.
- Проверки: `pnpm check` зелёный (локально, свой Mongo replset и Redis).
- Ревью: independent-reviewer pass 1 — APPROVE (CRITICAL 0 / HIGH 0 / MEDIUM 2 / LOW 4). Исправлено: форматирование,
  готовность протоколов при > 20 гонках (`checked`, сортировка недавних), ссылка на вкладку жалоб маршрутов, «новые
  пользователи» — подтверждённые и не удалённые. Не исправлено (осознанно): три порта читают коллекции своего модуля
  напрямую (rides, tracks) — прецедент `ActivityTotalsService`; споры переведены на репозиторий (сторож коллекций); фильтр `RidesOverview.reportedCount` повторяет `listReported` (одно
  условие частичного индекса).
- Follow-up: экран сбоев удаления аккаунтов (F13); номер миграции — сверить с «Достижениями» (0035) перед мержем.
