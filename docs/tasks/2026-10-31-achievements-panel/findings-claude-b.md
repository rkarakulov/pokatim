# Findings — achievements-panel (PR B) — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..077031c0 (ee59409b + merge develop)
verdict: APPROVE

Проверено (evidence): `tsc --noEmit` admin — без ошибок; `vitest run src/features/rider-profiles src/ui/ReasonDialog.test.tsx
src/features/audit` — 5 файлов / 64 теста зелёные; `eslint --max-warnings=0` по затронутым каталогам — чисто;
`depcruise apps/admin` — без нарушений; `prettier --check` по diff — чисто. `pnpm e2e:admin` — NOT VERIFIED (нет mailpit,
как и у автора; смоук карточку райдера не открывает).

Измерения без замечаний:
- correctness / контракт: тело выдачи соответствует `GrantRiderAchievementRequest` (`level` только при `isLeveledCode`;
  сезонная — тоже `objectId`, как в схеме); отзыв/снятие — `seasonId` ⇔ `isSeasonalCode` (`OverrideTarget`). 400
  `objectId` сервер отдаёт как `VALIDATION_FAILED` с `fields[].path === 'objectId'` (`achievements-panel.service.ts:71`) —
  совпадает с `hasObjectError`; 409 — `AchievementInvalidStateDetails.reason`.
- права: `useCan` вызван в `RiderProfileScreen` до ранних return; без права нет ни блока, ни запроса (тест); 403 запроса
  блока — `return null` после всех хуков; глобальный 403 `query-client.ts` лишь перечитывает `me`, карточку не ломает.
- деструктивные действия: «Отозвать» — `destructive`, обязательная причина (`ReasonDialog`), предупреждение «причина
  видна команде» во всех трёх окнах.
- состояния: скелетон и `ErrorState` с повтором — `DataTable`; ошибка обновления при данных — `RefreshFailedBanner`
  (общий баннер таблицы отключён, данные не прячутся); пусто; `seasonsAvailable: false`; мутации — `busy`.
- общие ui: `ReasonDialog.confirmDisabled` и `SelectField options[].disabled` — необязательные, по умолчанию прежнее
  поведение; остальные потребители не меняются (типы совместимы, тесты `ReasonDialog` зелёные).
- i18n: все строки — `ru.ts`; динамические ключи типизированы (typecheck зелёный). Подсказки «где взять id» ссылаются на
  существующие маршруты (`races/$raceId`, `routes/$routeId`, `rider-routes/$routeId`, `rides-moderation/$rideId`,
  `seasons/$seasonId` в `router.tsx`).
- дизайн-система: только компоненты `src/ui` и существующие классы (`section`, `section__title`, `toolbar`,
  `table__actions` — `index.css`); тоны `StatusTag` из имеющихся (B1 записан).
- журнал: детали без названий объектов и имён (M6); тест на три действия.
- Documentation Sync: `admin-panel.md`, `pokatim-web.md` (включая исключение `useState`), task.md 8.2/12 — обновлены.
- тесты: поведенческие (тела запросов, инвалидация `['admin','audit']`, перечитывание при 409, `aria-invalid` под полем,
  класс деструктивной кнопки), не тавтологии.

### [MEDIUM] После 409 `already_granted` окно выдачи молча переключает код — повторное «Выдать» выдаст другое достижение
- **file:** apps/admin/src/features/rider-profiles/GrantAchievementDialog.tsx
- **location:** `const code = picked && !granted.has(picked) ? picked : firstFree;`, `confirm` (ветка `isInvalidState` → `onStale`)
- **problem:** при 409 блок перечитывается (`onStale`), выбранный код становится «уже выданным», и `code` без явного
  действия админа падает на `firstFree`. Причина и id объекта сохраняются, `confirmDisabled` по-прежнему `false`
  (UUID валиден), подпись поля id может смениться на другой вид. Повторный клик «Выдать» (типичная реакция на ошибку)
  отправит выдачу **другого** кода с тем же объектом и причиной.
- **why_it_matters:** ручная выдача — чувствительное действие с записью в append-only журнал и уведомлением райдеру;
  незаметная подмена предмета действия ведёт к ошибочной выдаче (сервер её примет, если объект подходит виду нового
  кода, напр. два гоночных кода) и к записи в журнале, которую нельзя удалить, только отозвать.
- **evidence:** `if (isInvalidState(error)) await onStale(); throw error;` + вычисление `code` при каждом рендере из
  нового `items`; текст ошибки «У райдера уже есть это достижение — список обновлён.» не говорит, что выбор изменился.
  Тест `ошибка выдачи — текст в окне` проверяет только текст и перечитывание, не состояние формы после.
- **recommended_fix:** после 409 не подменять выбор молча: оставить выбранный (теперь недоступный) код и блокировать
  подтверждение (`confirmDisabled` при `granted.has(code)`), либо сбросить `objectId`/выбор, чтобы админ выбрал заново;
  добавить RTL-проверку состояния формы после 409.

### [LOW] Невалидный id объекта — кнопка неактивна без объяснения
- **file:** apps/admin/src/features/rider-profiles/GrantAchievementDialog.tsx
- **location:** `confirmDisabled={!Uuid.safeParse(id).success}`
- **problem:** при введённой, но не UUID строке (опечатка, вставлен весь URL) «Выдать» просто неактивна; под полем —
  только подсказка «где взять id», ошибки формата нет.
- **why_it_matters:** доступность и понятность (web.md «Доступность», pokatim-web: причины недоступности объясняются);
  админ не понимает, почему подтвердить нельзя.
- **evidence:** `TextField error` выставляется только по `objectError` (ответ сервера).
- **recommended_fix:** при непустом невалидном `id` показывать под полем текст вроде «Это не id — скопируйте его из
  адреса страницы» (новый ключ i18n), или принимать вставленный URL и извлекать последний UUID.

### [LOW] Фокус теряется после «Отозвать»/«Вернуть автоматике»
- **file:** apps/admin/src/features/rider-profiles/RiderAchievementsSection.tsx
- **location:** `run` (`await refresh()` до `onClose` в `ReasonDialog`), `rowButton`
- **problem:** `ReasonDialog` вызывает `onClose` после `onConfirm`, а `onConfirm` ждёт перечитывания блока; к закрытию
  окна кнопка-триггер строки уже размонтирована (у отозванной нет «Отозвать», у снятой — «Вернуть автоматике»), и
  `Dialog` фокусирует отсоединённый элемент — фокус уходит на `body`.
- **why_it_matters:** клавиатурная навигация / скринридер (7.4 «фокус возвращается на кнопку после закрытия»).
- **evidence:** `Dialog.tsx`: `trigger?.focus()` в cleanup layout-эффекта; триггер — кнопка строки, которая исчезает
  после `invalidateQueries`.
- **recommended_fix:** при исчезновении триггера переводить фокус на заголовок блока (`h2` с `tabIndex={-1}`) или
  кнопку «Выдать вручную»; либо закрывать окно до ожидания перечитывания.

### [LOW] «Выдать вручную» доступна до загрузки списка и при ошибке без данных
- **file:** apps/admin/src/features/rider-profiles/RiderAchievementsSection.tsx
- **location:** `<Button onClick={() => setGranting(true)}>` и `items={query.data?.items ?? []}`
- **problem:** пока список не загружен (или загрузка упала), окно выдачи считает, что выданных кодов нет — все коды
  доступны, подсказка «уже выдано» отсутствует.
- **why_it_matters:** админ действует вслепую; сервер вернёт 409, и сработает сценарий из MEDIUM выше.
- **evidence:** `grantedCodes([])` → пустое множество.
- **recommended_fix:** делать кнопку `disabled` (с причиной) до `query.data`, оставив её видимой (AGENTS §4.12).

## Вердикт

APPROVE — CRITICAL/HIGH нет. Рекомендуется исправить MEDIUM (подмена кода после 409) до merge.
