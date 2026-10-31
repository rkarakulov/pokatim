# Findings — social-p1-notifications — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..43244214 (1 коммит, working tree чистый)
verdict: APPROVE

Проверено руками: unit `src/modules/notifications` — 10 файлов / 156 тестов pass; int (реальная Mongo replica set
`:27117`, своя БД `pokatim_social_p1_review_test`, Redis db 13, `--no-file-parallelism`)
`notifications-social`, `notifications-intake`, `notifications-delivery` — 103/103 pass. Первый прогон на Redis db 11
дал 7–10 красных в intake/delivery и одном social-тесте лимита; на db 13 все зелёные. Похоже на общий Redis db с
другой сессией (лимиты и задачи BullMQ), к diff отношения не имеет. Полный `pnpm check` — NOT VERIFIED (не запускался,
AC8 за оркестратором).

Измерения без замечаний: накопление RC-1a (фильтр `$ne` + `actors.99 $exists:false`, `$setOnInsert` создающего
события и доставки, один повтор без upsert на любой дубль — гонка первой вставки, повтор задачи, потолок; отрицательные
доказательства в §12); push только при создании (`scheduleEvent` по `sourceEventId` второго события ничего не находит);
окно по дню события uuidv7 в Минске; authz подресурса (`AuthGuard`, `userId` сессии, `strictObject`, общий лимит,
`PUT /settings` `push.social` не стирает — int); N12/K13 (имя и `publicId` только из `publicRiders`, где в фильтре
есть `showNameInResults: true`, `userId` лиц наружу не уходит, сводка без имён, в логах имён нет); совместимость
(справочники дописаны в конец, `tolerantEnum` у вида и группы, `NotificationTargetView` уводит незнакомое в
`unknown`, `/settings` строгий и не менялся, 404 подресурса — блока нет); service worker и `notificationTargetPath`
парсят через `RiderPublicId`, паритет — тест; placement (`social-notices.ts`, нет импорта `social`, `ProfileCoreModule`
только в HTTP- и worker-модуле); миграций нет — поля аддитивные, индекс прежний; i18n — одна строка в конце;
дизайн-система и состояния данных — `PushOnlyGroup` как у «Достижений»; Documentation Sync §10 — `notifications.md`,
ADR-0017/0027 и правила обновлены (`pr.md` — артефакт finish-фазы, его пока нет).

### [MEDIUM] Сбой `publicRiders` в push происходит после списания лимита и вне обработки сбоя отправки
- **file:** apps/api/src/modules/notifications/push-delivery.ts
- **location:** `deliver`, строки 119–125 (`await this.names.publicRiders(...)` после `rateLimiter.consume`, до блока отправки)
- **problem:** новый внешний вызов (чтение `profiles`) вставлен между списанием лимита 20/ч и участком, где сбои
  обрабатывает `sendFailed`. Исключение `publicRiders` (сбой Mongo, таймаут) выходит из `deliver` и не вызывает ни
  `settlePush(..., { state: 'pending', limitCharged: true })`, ни снятия захвата.
- **why_it_matters:** документ остаётся в `push.state: 'sending'` до `claimedUntil`. Ретрай BullMQ раньше конца аренды
  ничего не захватит (`none`) и завершит задачу успешно. Push дойдёт только через регламент `redeliver` (*/10), то есть
  на 10+ минут позже, и спишет лимит второй раз: `limitCharged` не выставлен. До этого PR после `consume` до защищённой
  отправки ничего не бросало, это новое окно сбоя. Запасной текст с «Райдер» хранится как раз для случая «рендер с
  именами не смог» (RC-3), но здесь он не используется.
- **evidence:** `const limited = charged ? … : await this.rateLimiter.consume(...)` → `const cards = … ? await
  this.names.publicRiders(only.actors ?? []) : new Map()`; `sendFailed` вызывается только в ветке `delivered === 0 &&
  (expoError !== null || webUnavailable)`.
- **recommended_fix:** запрашивать карточки до `rateLimiter.consume` (сразу после проверки тихих часов или токенов).
  Либо обернуть вызов в `try/catch`: при сбое `cards = new Map()` и отправить сохранённый запасной текст, в лог
  записать только `uid` и класс ошибки. Стоит добавить unit/int-тест: `publicRiders` бросает → push уходит с запасным
  текстом (или захват снят с `limitCharged`).

### [LOW] Потолок длины `params.object` держит только `socialNoticeDraft`, а пачка проверяет его zod-схемой
- **file:** apps/api/src/modules/notifications/notification-fanout.ts / notifications.events.ts
- **location:** `renderDraft` → `socialParamsOf(draft.text)`; `FanoutJobData.social.params: SocialNoticeParams` (max 200)
- **problem:** `socialParamsOf` копирует `text.object` без обрезки. Если P7 соберёт `NoticeDraft` в обход
  `socialNoticeDraft`, название длиннее 200 по прямому пути (≤ 200 получателей) запишется в документ, и `renderSocialNotice` покажет
  запасной текст. В пачке (> 200 получателей) zod-разбор `FanoutJobData` такую задачу отклонит, и она падает на
  каждом ретрае.
- **why_it_matters:** при одном и том же входе прямой путь и пачка ведут себя по-разному. Ошибка проявится только на
  большой аудитории «Свои идут».
- **evidence:** `socialParamsOf`: `{ object: text.object }`; обрезка `.slice(0, OBJECT_TITLE_MAX)` есть только в
  `socialNoticeDraft`.
- **recommended_fix:** обрезать или нормализовать в `socialParamsOf` (`oneLine(...).slice(0, OBJECT_TITLE_MAX)`). Либо
  записать в JSDoc `NoticeDraft.actor`, что социальный черновик собирает только `socialNoticeDraft`.

### [LOW] Пробелы тестов, которые признаёт сам coder (AC5, AC7)
- **file:** apps/api/src/modules/notifications/notifications-social.int.test.ts
- **location:** блоки «push «Своих»» и «стирание аккаунта»
- **problem:** нет int-проверки Web Push payload с целью `rider` (проверен только Expo `data.target`). Стирание
  проверено портами `ProfileErasure` + `NotificationErasure`, а не полным `AccountErasure`.
- **why_it_matters:** риск невелик, потому что `contentOf` общий для обоих транспортов, а account int-тесты зелёные.
  Но AC5 («Web Push payload с целью `rider`», §11 TESTS) закрыт косвенно.
- **evidence:** task.md §12 «Не проверено».
- **recommended_fix:** добавить один кейс в `notifications-delivery.int.test.ts` с фейковым Web Push
  (`test/fake-web-push.ts`): расшифровать тело и проверить `target.type === 'rider'`.

## Статус исправлений (coder, 2026-10-31)

- **[MEDIUM] сбой `publicRiders` в push — исправлено.** `PushDelivery.socialCards`: `try/catch`, при сбое — пустая
  карта, уходит запасной текст документа («Райдер», цель `null`), лог `notifications.push_names_failed uid=<uid>
  error=<класс>`. Выбран вариант с запасным текстом, а не перенос до `consume`: исключение после `claimPush` всё равно
  оставило бы документ в `sending`. Тест — `notifications-social.int.test.ts` «сбой запроса имён…» (был красным до
  правки).
- **[LOW] потолок `params.object` — исправлено.** `socialParamsOf` — `oneLine(...).slice(0, 200)`; unit-тест в
  `social-notices.test.ts`.
- **[LOW] пробелы тестов Web Push / `AccountErasure` — не менялось** (признано в §12 task.md).

# Findings — social-p1-notifications — pass 2 — reviewer: claude
base: origin/develop   commits: исправления 9d6e0f41 (поверх — merge develop 5abcb732, чужие изменения не ревьюились)
verdict: APPROVE

Проверено руками: `vitest run --no-file-parallelism src/modules/notifications` на Mongo `:27117`
(`pokatim_social_p1r_test`) и Redis db 13 — 16 файлов / 333 теста pass (unit + int, в том числе новый кейс «сбой
запроса имён…»). `tsc --noEmit` в `apps/api` — чисто. Полный `pnpm check` — NOT VERIFIED (за оркестратором).

**[MEDIUM] pass 1 (сбой `publicRiders` в push) — закрыто.** `PushDelivery.socialCards` ловит сбой: пустая карта,
`contentOf` отдаёт запасной текст («Райдер», `target: null`). После этого `deliver` идёт обычным путём. Захват
закрывается в `sent`/`failed` или через `sendFailed` (`pending` + `limitCharged: true`). Документ в `sending` больше
не остаётся, второго списания лимита нет. Вариант лучше переноса вызова до `consume`: исключение после `claimPush`
всё равно оставило бы захват висеть. Лог `notifications.push_names_failed uid=… error=<error.name>` без
`message`, имён и `userId` действующих лиц нет. Условие выбора лиц (`due.length === 1 && group === 'social'`)
эквивалентно прежнему. Регрессий нет: лимит, тихие часы, токены и ветки sent/failed/sendFailed не менялись. Тест
честный. `vi.spyOn` подменяет экземпляр `RIDER_NAMES` из worker-контейнера, тот же, что внедрён в `PushDelivery`.
Без `try/catch` reject дошёл бы до `runPush`, и тест упал бы. Проверяются тело, `data.target`, `state: 'sent'`,
`claimId: null` и то, что повторный прогон ничего не захватывает (`none`).

**[LOW] pass 1 (потолок `params.object`) — закрыто.** `socialParamsOf` теперь даёт `oneLine(...).slice(0, 200)`.
Это та же нормализация, что в `socialNoticeDraft`, поэтому значение для `SocialNoticeParams.max(200)` совпадает на
прямом пути и в пачке. Для черновиков из `socialNoticeDraft` повторная нормализация идемпотентна. Unit-тест
проверяет перевод строки, обрезку и отсутствие `object`.

**[LOW] pass 1 (Web Push payload с `rider`, полный `AccountErasure`)** — без изменений, признано в §12 task.md. Не
блокирует.

Новых замечаний нет.
