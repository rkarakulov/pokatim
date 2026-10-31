# Findings — social-p2-ride — pass 1 — reviewer: claude
base: beca1db2 (origin/develop)   commits: beca1db2..36c7f5ad
verdict: APPROVE

Проверено: diff целиком (API social/rides, contracts, api-client, i18n, app, docs, rules), P0
(`attendance.service.ts`, `social.policy.ts` `attendanceCheck`), порт `rides-for-social.ts`, `rider-names.port.ts`,
`rides.policy.visibleTo`, кэш-ключи `features/rides/queries.ts`, пересечение маршрутов `rides/:id/*` (коллизий нет).

Запуски (изоляция `pokatim_social_p2_review_test`, Redis db 10):
- `vitest run src/modules/social/ride-participants src/modules/rides/rides-join-source src/modules/social/social.policy.test.ts` → 4 files, 30 tests passed.
- `jest src/__tests__/ride-detail.test.tsx src/features/rides/format.test.ts` → 2 suites, 69 tests passed.
- `pnpm arch:check` → no dependency violations.
- Полный `pnpm check` — NOT VERIFIED (за оркестратором).

Измерения без замечаний: безопасность (AuthGuard на трёх эндпоинтах, `no-store`, строки — явный список полей из
`publicRiders`, `userId` нет, int-тест строкой; скрытый райд — 404 до P0, RC-1; лимит `social-attendance` первым, общий
на оба POST); P0 переиспользован без дублирования (`markManual`/`unmark`, `attendanceCheck` для флагов); порт
`RIDES_FOR_SOCIAL` не менялся; `ride-joined` — после коммита, только при `joined !== null` и `source`, сбой — warn без
отказа; совместимость (тело `join` optional + strict, все значения `RIDE_JOIN_SOURCES` уже в P0; новые поля ответа —
`.default`, `state` — `tolerantEnum`); кэш-ключ под `['rides']`, `applyRideView` пишет только `…/me`, перетирания нет;
миграций/очередей нет; i18n — ключи в `ru.ts`; §4.12 — скелетон, баннер с повтором, карточка видна; §4.13 — общий
код без платформенных развилок, ссылки строк — тот же паттерн `router.push(riderPath)`, что в `table-row.tsx`;
Documentation Sync — rides.md, social.md, ADR-0027 п. 3/7, четыре файла правил обновлены (`pr.md` — шаг FINISH, §8.2).

### [MEDIUM] Текст отказа 409 исчезает сразу после перезапроса участников
- **file:** apps/app/src/features/rides/ride-participants-block.tsx
- **location:** `ParticipantsContent` — `actionable` и рендер `<AttendanceActions …>` (ошибка мутации живёт только внутри `AttendanceActions`); `participants-queries.ts` `onError` → `invalidateQueries`
- **problem:** Текст ошибки мутации рисуется внутри `AttendanceActions`, а сам блок рендерится только при `canMark || canDecline`. При реальном `409 attendance_window` (окно закрылось при открытой карточке) или `ride_unavailable` `onError` перечитывает участников, сервер отдаёт флаги `false` → `actionable === false` → `AttendanceActions` размонтируется вместе с баннером ошибки. Пользователь видит, как кнопка пропала без объяснения.
- **why_it_matters:** Spec §11 TESTS / AC5: «409 `attendance_window` — текст под действием и перезапрос участников»; AGENTS §4.12 «мутации — состояние кнопки, ошибка — текст под действием». Тест `ride-detail.test.tsx` («Меня не было» → … 409 attendance_window) этого не ловит: мок `rideParticipants` при перезапросе возвращает те же открытые флаги, хотя на сервере после 409 они были бы закрыты.
- **evidence:** `{attendance && actionable ? (<AttendanceActions attendance={attendance} mutation={mutation} />) : null}`; внутри — `{mutation.error ? (<Banner tone="error" message={attendanceErrorText(mutation.error)} />) : null}`.
- **recommended_fix:** Выносить баннер ошибки мутации из условия `actionable` (рисовать при `mutation.error` и блоке явки/`attendance !== null`), либо держать `AttendanceActions` смонтированным, пока есть `mutation.error`. В тесте после 409 мокать перезапрос с `canMark: false, canDecline: false` и проверять, что текст остаётся.

### [LOW] Тест «стопка с фото публичных» не доказывает, что `GoingStack` получил `avatarIds`
- **file:** apps/app/src/__tests__/ride-detail.test.tsx
- **location:** describe «участники и явка (P2, K4, K5)», первый тест — `getAllByTestId('rider-avatar-photo').length >= 1`
- **problem:** `rider-avatar-photo` рисует и строка списка («Райдер 1» с аватаром), поэтому проверка пройдёт и без передачи `avatarIds` в стопку.
- **why_it_matters:** AC5 «стопка с аватарами» фактически не покрыта; регрессия в `ride-detail.tsx` (проп не передан) останется зелёной.
- **recommended_fix:** Проверять `toHaveLength(2)` (стопка + строка) или искать фото внутри контейнера стопки (testID / `within`), плюс — что `going-avatar-icon` остаётся у квадратов без публичного участника.

## Исправления оркестратора (2026-10-31)

- MEDIUM (текст 409 пропадает) — исправлено: баннер ошибки мутации вынесен из `AttendanceActions` в
  `ParticipantsContent` (вне условия `actionable`). Тест: после 409 перечитанные флаги закрыты — кнопки нет, текст
  причины виден. Отрицательное доказательство: на прежнем компоненте тест красный, с правкой — зелёный.
- LOW (стопка с фото) — исправлено: у `GoingStack` `testID="going-stack"`, фото проверяется внутри стопки.
- Проверки: `jest ride-detail.test.tsx` — 62/62; `tsc --noEmit` app и eslint затронутых файлов — чисто.
