# Findings — social-p5-auto-attendance — pass 1 — reviewer: claude
base: origin/develop   commits: working tree (незакоммичено, вместе с неотслеживаемыми файлами)
verdict: APPROVE

## Что проверено

- Сверка K2 (`autoAttendanceCheck`, `AutoAttendanceIntake`). Окно запроса `ridesOfParticipant`
  `[startedAt − afterMs; startedAt + beforeMs]` — это ровно условие `startsAt − 30 мин ≤ startedAt ≤ startsAt + 2 ч`,
  границы включительно. Далее по порядку: фаза `past` (RC-P5-4), `preciseStart`, `now ≤ startsAt + 7 дн` по `CLOCK`,
  `haversineMeters` из `@pokatim/tracks` (своей формулы нет), `cycling` по основной. `declinedAt` держит
  `AttendanceRepository.markByTrack` (условие `'entries.userId': {$ne}`). Владелец берётся из `tracks`, payload не
  используется.
- Идемпотентность intake. Повтор и событие дубля дают no-op: условный `$push`, а событие пишется только при
  `true`. Два параллельных события одной группы (основная + дубль) конфликтуют по документу явки, вторая транзакция
  повторяется и возвращает `false`, второго события нет.
- 404/409 из `markByTrack`. Ловятся по каждому райду отдельно (`isDomainError` + status). Остальные ошибки
  пробрасываются, повтор безопасен. Int-тест RC-P5-5 провоцирует реальный 409 через устаревшие факты.
- Регламент. Захват `{_id, askedAt: null}` → `$set` в транзакции после `ensure`; адресаты читаются на снимке той же
  транзакции; `due` вызывается в той же `tx`. Параллельные прогоны и отметка явки в тот же момент дают write
  conflict, `MongoTransactions.run` повторяет, итог `false`/свежие `entries`. Окно `[now−28 ч; now−4 ч]`
  включительно, keyset `changedWithin` корректен (пустой id — время курсора включительно), цикл гарантированно
  завершается. Отменённые и скрытые отсекаются `status: 'published'`.
- Логи: только id события, райда, итог и `count`. Координат и id райдеров нет (`LoggingRideAskDue`, `social.intake`,
  `social.ride_ask_failed`).
- Границы модулей: `tracks`/`rides` не импортируют `social`, порт `ACTIVITY_STARTS` экспортируется через `index.ts`.
  Один `registerQueue`, один `@Processor(QUEUE.socialIntake)`. Три файла `notifications`, миграции, `contracts` и
  `apps/app` не тронуты. Валидатора `$jsonSchema` у `ride_attendance` нет, поле `askedAt` пишется свободно.
- Evidence (запуски этого ревью, изоляция `pokatim_social_p5_test` / Redis db 9):
  - `pnpm arch:check` → `no dependency violations found (2489 modules, 10023 dependencies cruised)`;
  - `pnpm --filter @pokatim/api typecheck` → exit 0; `eslint --max-warnings=0` (social, tracks/activity-starts*, rides)
    → 0; `prettier --check` → OK;
  - `vitest run src/modules/social src/modules/tracks/activity-starts.int.test.ts
    src/modules/rides/rides-for-social.int.test.ts src/outbox-routes.test.ts` → 15 files, 137 tests passed.
- Тесты не тавтологичны. Если убрать проверку 7 дней, int-кейс покраснеет: у `attendanceCheck` по `'track'` окна нет,
  и явка встанет. Если убрать `no_precise_start`, разрушение `null` даст бросок. Если убрать catch 409, RC-P5-5 станет
  красным. Подмена основной на дубль ловится в `activity-starts.int.test.ts`.

## Findings

### [LOW] `claimAsk` → `ensure` выставляет `updatedAt` при создании документа, хотя правило говорит «не трогает»
- **file:** apps/api/src/modules/social/attendance.repository.ts
- **location:** `claimAsk` (стр. 105–113) → `ensure` (стр. 24–30)
- **problem:** если у райда не было явки, захват создаёт документ `{ entries: [], updatedAt: now }`. Значит,
  `updatedAt` = время захвата, а явка при этом не менялась.
- **why_it_matters:** `.claude/rules/pokatim-db.md` (новая строка P5) и комментарий `AttendanceDoc.askedAt` обещают,
  что `updatedAt` захват не трогает и что это «время изменения явки». Сейчас `updatedAt` никто не читает, проверено
  grep-ом, так что сбоя нет. Будущий keyset по `updatedAt` получил бы по документу на каждый прошедший райд.
- **evidence:** `$setOnInsert: { entries: [], updatedAt: now }` в `ensure`; `claimAsk` вызывает `ensure(tx, rideId, now)`.
- **recommended_fix:** уточнить строку в `pokatim-db.md`: «существующий `updatedAt` не меняется; новый документ
  получает время захвата». Код можно не трогать.

### [LOW] Documentation Sync: §8.2 task.md говорит, что `docs/product/social.md` не менялся, а diff его меняет
- **file:** docs/tasks/2026-11-01-social-p5-auto-attendance/task.md, docs/product/social.md
- **location:** task.md §8.2, последний пункт; social.md K5, +2 строки после «Как прошёл райд?»
- **problem:** в K5 добавлены две строки: про окно догона в сутки и про то, что райды до выката P7 вопроса не
  получат, с пометкой «решения автора 2026-11-01». А §8.2 утверждает «`docs/product/social.md` не менялся… — после
  подтверждения пользователем».
- **why_it_matters:** разделы task.md и diff расходятся. Ревьюер не может проверить, было ли подтверждение
  (NOT VERIFIED: в task.md записи о нём нет).
- **recommended_fix:** обновить §8.2/§12, указав факт и источник подтверждения RC-P5-10/11. Если подтверждения не
  было, убрать строки из social.md.

### [LOW] Устаревшие комментарии и длинная строка в комментарии
- **file:** apps/api/src/outbox-routes.ts; apps/api/src/modules/social/social-intake.processor.ts
- **location:** outbox-routes.ts:33; social-intake.processor.ts, JSDoc класса (вторая строка)
- **problem:** в outbox-routes.ts:33 у `socialOutboxRoutes` по-прежнему указано только
  `identity.account-confirmed (P6)`, хотя теперь там и `tracks.activity-ready` (P5). В JSDoc
  `SocialIntakeProcessor` вторая строка не перенесена и заметно длиннее 120 символов: prettier комментарии не
  переносит.
- **why_it_matters:** только навигация и читаемость.
- **recommended_fix:** дописать в комментарий outbox-routes.ts «; tracks.activity-ready — автоявка (P5)» и перенести
  строку JSDoc.

### [LOW] `SocialCoreModule` экспортирует `AttendanceRepository` всем потребителям ядра
- **file:** apps/api/src/modules/social/social.module.ts
- **location:** `SocialCoreModule.exports` (последний элемент)
- **problem:** `SocialCoreModule` импортируют `account` и `sharing`, и в их DI-графе теперь виден единственный
  писатель `ride_attendance`.
- **why_it_matters:** практического обхода нет: класс не экспортируется в `index.ts`, а deep import запрещает
  `arch:check`. Это только расширение поверхности, отклонение уже записано в §8.2.
- **recommended_fix:** по желанию — вынести внутренний `SocialAttendanceCoreModule` или оставить как есть с
  отметкой в §8.2 (уже есть).

## Verdict

APPROVE: CRITICAL и HIGH нет. Четыре LOW, все касаются документации и комментариев, на корректность и acceptance
(AC1–AC6) не влияют.

## Разбор pass 1 (оркестратор, 2026-11-01)

- LOW-1 — формулировка правила `pokatim-db.md` уточнена (документ, созданный захватом, получает `updatedAt`).
- LOW-2 — подтверждение пользователя получено 2026-11-01 (оба значения по умолчанию); §8.2 исправлен.
- LOW-3 — комментарий `outbox-routes.ts` и перенос JSDoc `social-intake.processor.ts` исправлены.
- LOW-4 — принято как есть: класс не в `index.ts`, deep import держит `arch:check`.
