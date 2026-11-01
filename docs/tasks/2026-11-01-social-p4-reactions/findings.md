# Findings — social-p4-reactions — pass 1 — reviewer: claude
base: f42ac639 (merge-base origin/develop)   commits: 9d897cca (c173efb7 — merge develop, не ревьюился)
verdict: APPROVE

CRITICAL/HIGH нет. Ниже три LOW.

Что проверено (по измерениям контракта):
- correctness / видимость строки: `publicRow` идёт через `publicTableMode`; до публикации — `rankedPosition` на
  `rankedFilter` (active, verified, `best.ranked`, `disqualified: null`); после — `protocolRow` текущей ревизии и
  `isPublicProtocolRow`. Это совпадает с `publicResults`/`protocolRowsPage` (`status $ne 'dq'`, `place !== null`).
  Рефакторинг `protocolResults` поведение не меняет: в `buildProtocol` у DQ-строк `place: null`. Черновик отсекает
  `RaceRegistry.get`. Несовпадение `raceId` пути с гонкой цели даёт `null`.
- AuthZ / утечки: получатель берётся только из портов. `from` собирается только при `own` и только через
  `RIDER_NAMES.publicRiders`; `hiddenCount = count − riders` (учтён и предел 100). В схемах и логах нет `userId`/имён.
  Публичные `GET races/:raceId/results` и `routes/:id` побайтно не меняются (есть int-тест, `max-age=60`).
  Ответ 409 `not_attended` по `publicId` ничего не раскрывает: при явке зрителя тот же список и так виден в «Ехали N».
- Гонки: `PUT true ‖ PUT true` — уникальный индекс, `insert` → `false`. `thankAll ‖ thank` — дубль ловится по
  каждой реакции. `PUT true ‖ false` — побеждает последний, ответ — свежее чтение.
- Лимиты стоят первыми (`social-thanks`, `social-respect`), у GET лимита нет. Это соответствует §11.
- Дублей P0/P2 нет: один писатель (`ReactionsRepository`), все новые реакции идут через приватный `insert`
  (точка P7). `toggleRespect` не тронут. `riderGroup` переиспользован через `groupOf`. `IN_CATALOG` и правило
  таблицы вне своих модулей не копируются.
- Границы: `social → results|routes` только через `index.ts`; порты подключены в HTTP `SocialModule` (RC-P4-12).
  Новые зависимости `SocialRideParticipantsService` (`RIDER_PROFILES`, `SocialReactionsService`) в
  `SocialCoreModule` есть: импортирован `ProfileCoreModule`. `notification-intake.ts`, `notification-texts.ts`,
  `notifications.policy.ts` не изменены (`git diff --stat` по `notifications/` пуст).
- Пути: `races/:raceId/results/:entryId/respect` и `routes/:id/respect` ни с одним контроллером не пересекаются
  (results/sharing/disputes/routes-viewer/route-card).
- Контракты: старые сборки отбрасывают `self`/`thanked`/`allThanked` (z.object strip). Новые сборки на старом
  ответе получают `.default(false)`. Добавления в конец `contracts/index.ts`, `api-client`, `ru.ts`.
- App: «Оспорить» показывается только при `participation?.entry` (RC-P4-10), `canOpenRival` удалён. Строки
  нажимаемы любому вошедшему, своя — при заявке (RC-P4-11). «Респект автору» — при `passed && !mine`.
  Состояния: однострочный скелетон, ошибка через `AsyncContent` с повтором, `loading` у кнопок.
  i18n — ключи `{count}` в формате проекта. Кэш `['social', …]` очищает `queryClient.clear()` при выходе.
- Тесты: AC1–AC9 покрыты int/unit/jest по существу, тавтологий нет. Запустил сам: jest `rival-card`, `ride-detail`,
  `route-ride` — 103/103 passed; vitest `respect.view.test.ts`, `ride-participants.view.test.ts` — passed.
  Int-тесты API (`social-respect`, `ride-thanks`, `social-reactions`, `results-for-social`, `routes-for-social`)
  локально запустить не удалось: на 127.0.0.1:27017 standalone mongod, адреса replica set я не нашёл. Для них
  принимаю доказательства coder (§12: 49 files / 599 passed); CI должен подтвердить.

### [LOW] Предикат «строка в зачёте» продублирован внутри `results`
- **file:** apps/api/src/modules/results/results.policy.ts
- **location:** 294–297 (`isPublicProtocolRow`)
- **problem:** `isPublicProtocolRow` дословно повторяет `isRankedRow` из `rider-results.port.ts:32`
  (`row.status !== 'dq' && row.place !== null`). У того же правила теперь две точки.
- **why_it_matters:** если правило зачёта/видимости изменится, одну копию легко забыть. Тогда статистика профиля
  и достижения (`isRankedRow`) разойдутся с таблицей и «Респектом». Нарушение не межмодульное, поэтому LOW.
- **evidence:** `rider-results.port.ts:32-33` и `results.policy.ts:297` — одинаковое выражение.
- **recommended_fix:** выразить одно через другое (например, `isRankedRow = isPublicProtocolRow`) или пометить
  комментарием, что это один предикат.

### [LOW] «Райд не найден» при 404 получателя «спасибо»
- **file:** apps/app/src/features/rides/participants-queries.ts
- **location:** 103 (`thanksErrorText`)
- **problem:** у `POST rides/:id/thanks` 404 бывает и тогда, когда `publicId` стал непубличным или неизвестным:
  райдер скрыл имя между загрузкой списка и нажатием. Клиент в этом случае показывает «Райд не найден», хотя
  карточка райда на экране.
- **why_it_matters:** текст ошибки вводит в заблуждение. После `invalidateQueries` строка райдера уходит в «и ещё N»,
  а баннер всё ещё говорит о райде.
- **evidence:** `if (code === 'NOT_FOUND') return t('rides.detail.notFound');`; на сервере 404 по `findPublic` —
  `ride-participants.service.ts` (`if (!recipient) throw domainError('NOT_FOUND', 404)`).
- **recommended_fix:** для 404 мутации «спасибо» показывать общий `rides.thanks.error.unknown` или отдельный текст
  («Райдер скрыл профиль»). Либо не показывать баннер: после перечитывания строки уже нет.

### [LOW] Карточка своей строки до загрузки участия рисуется как чужая
- **file:** apps/app/src/features/races/disputes/rival-card.tsx
- **location:** 121 (`const own = entry.data?.entry?.id === entryId`) и ветка `own ? … : …`
- **problem:** пока `useMyRaceEntry` грузится или завершился ошибкой, своя строка попадает в ветку чужой: заголовок
  «Соперник», `RespectButton`, `AsyncContent` участия со скелетоном или ошибкой. После загрузки ветка меняется на
  `RespectReceived`. Кнопка «Респект» не появляется — сервер отвечает `available: false`, — так что вреда нет,
  но заголовок и раскладка дёргаются.
- **why_it_matters:** §4.12 — скелетон должен повторять конечную раскладку. Мигание заголовка частично было и до
  P4, но P4 стал чаще открывать свою строку (RC-P4-11: всегда при заявке).
- **evidence:** `own` зависит только от `entry.data`. Флаг `own` из `GET …/respect` в выборе ветки не участвует.
- **recommended_fix:** (по желанию) пока `entry.isPending`, рисовать общий скелетон действий вместо ветки чужой
  строки; либо брать `own` ещё и из `respect.data.own`.

## Разбор (оркестратор, 2026-11-01)

- LOW «Райд не найден» при 404 «спасибо» — исправлено: `thanksErrorText` на `NOT_FOUND` — `rides.thanks.error.not_found`
  («Райдер больше недоступен — обновите список»), тест в `ride-detail.test.tsx`.
- LOW «предикат в зачёте продублирован» и LOW «своя строка до загрузки участия» — не исправлялись (вне CRITICAL/HIGH),
  follow-up в §12 task.md.
