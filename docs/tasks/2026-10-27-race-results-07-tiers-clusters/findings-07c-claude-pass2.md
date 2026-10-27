# Findings — race-results-07c — pass 2 — reviewer: claude
base: origin/develop   commits: origin/develop..45eff1e (8867932, 66a20f9 + merges)
verdict: APPROVE

Повторное ревью фикс-коммита 66a20f9 против findings-07c-claude.md и findings-07c-codex.md плюс поиск регрессий
в затронутых файлах и местах вызова (race-detail, results-table, tier-picker/group-picker, verified-profile-form,
races/queries, profile/queries, disputes/queries). Тесты и `pnpm check` не запускались (по заданию) — NOT VERIFIED;
evidence ниже — чтение кода и тестов.

Статус прошлых находок:
- [HIGH codex] вечный скелетон незагруженной вкладки без сети — ЗАКРЫТО. `TabFailure` показывает «Нет соединения» с
  повтором при `data === undefined && fetchStatus === 'paused'`, скелетон только при `loading()`; тест для вкладки
  группы и «Финишёров» (`onlineManager.setOnline(false)` → баннер → сеть вернулась → строки).
- [MEDIUM оба] 409 VERIFIED_DEMOGRAPHICS_LOCKED → снова 409 — ЗАКРЫТО для описанного сценария: `useEffect` +
  `resetField` синхронизирует `gender`/`birthYear` с сервером при `locked`, правки веса сохраняются; тест проверяет
  тело повторного PUT. `useEnterRace` с `tier: 'verified'` инвалидирует `VERIFIED_PROFILE_KEY`, тест — анкета из
  кэша открывается зафиксированной. Остаточный крайний случай — LOW ниже.
- [MEDIUM оба] pull-to-refresh вкладок — ЗАКРЫТО. `useRaceResultsRefetch` — `refetchQueries({ queryKey:
  raceResultsKey(id), type: 'active' })` покрывает `pages`, `pages/<group>`, `finishers`; отключённые запросы
  TanStack не перезапрашивает. Тесты для вкладки группы и «Финишёров» через `RefreshControl.onRefresh`.
- [LOW] TierPicker: обе кнопки уровня — ЗАКРЫТО (`disabled={enter.isPending}` у START и `VerifiedChoice`; тест в обе
  стороны).
- [LOW] незнакомый пол в заблокированной анкете — ЗАКРЫТО (обработчик `onInvalid` → баннер
  `profile.verified.error.lockedUnreadable`, PUT не уходит; тест).
- [LOW] переход при VERIFIED_PROFILE_REQUIRED — ЗАКРЫТО (`useVerifiedEnter`: `router.push(verifiedProfilePath(raceId))`
  для заявки и повышения; тест проверяет путь и `?race`).
- [LOW] epic.md — ЗАКРЫТО (07a #73, 07b #75 слиты, 07c на ревью).

Регрессии не найдены: `results` по-прежнему передаётся в таблицу; `raceResultsKey` больше никто не держит активным
вне карточки; импорт `profile/queries` → `races/queries` цикла не создаёт (profile/queries от races не зависит);
`await invalidateQueries(VERIFIED_PROFILE_KEY)` в `onSuccess` на карточке гонки ничего не ждёт (запрос анкеты там
неактивен) и ошибок не бросает.

### [LOW] Анкета, открытая сразу заблокированной, не подхватывает новые пол/год сервера
- **file:** apps/app/src/features/profile/verified-profile-form.tsx
- **location:** `useEffect` с `form.resetField('gender' | 'birthYear', …)` (~стр. 128–136)
- **problem:** `resetField` в react-hook-form 7 ничего не делает, если поле не регистрировалось (`get(_fields, name)`
  пусто). Если форма смонтирована уже в locked-режиме, контроллеры `gender`/`birthYear` не монтируются, и сброс —
  no-op. Пока серверные значения не меняются, это безопасно: `defaultValues` уже серверные. Но если
  зафиксированные пол/год поменяет команда платформы, пока экран открыт, следующее сохранение уйдёт со старыми
  значениями → 409 → refetch, а deps эффекта уже совпадают с серверными, и сброса нет. Цикл 409 до ухода с экрана.
- **why_it_matters:** крайний случай того же класса, что и закрытый MEDIUM. Затрагивает только поддержку,
  меняющую демографию при открытой анкете, поэтому не блокирует.
- **evidence:** в тестах фикса блокировка наступает после регистрации полей (пользователь нажал «Женский»). Сценария
  «смонтирована locked → сервер прислал другие пол/год» нет.
- **recommended_fix:** в locked-режиме брать пол и год для PUT из `view.profile` в `onSubmit`, а не из значений
  формы (например, `locked ? { ...values, gender: view.profile.gender, birthYear: view.profile.birthYear } : values`).
  Либо использовать `form.setValue(..., { shouldDirty: false })`, которое работает и для незарегистрированных полей.

Итог: CRITICAL/HIGH нет, все находки pass 1 (обоих ревьюеров) закрыты, регрессий нет → APPROVE.
