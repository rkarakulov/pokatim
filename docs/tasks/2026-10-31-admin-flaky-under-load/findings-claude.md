# Findings — admin-flaky-under-load — pass 1 — reviewer: claude
base: origin/develop   commits: 3905f6ae
verdict: APPROVE

Проверено вручную:
- **Отрицательные ожидания (вопрос 1).** В админке нет `expect(findBy…).rejects`, нет `.catch`/`.then` на `findBy*`/`waitFor`.
  Все `waitFor(() => expect(query…).toBeNull())` (admin-02-ui, ReasonDialog, EventTickets, Security, Dispute,
  AccountErasures, RaceResults, VerifiedDemographics, Audit, RiderRoute, RiderProfile, RiderAchievements, Members)
  ждут исчезновения: условие либо уже выполнено, либо станет выполненным. Такой `waitFor` возвращается на первом
  успешном опросе, поэтому срок не влияет ни на скорость зелёного прогона, ни на силу проверки. Проверки «ещё не
  появилось» сделаны синхронным `queryBy` после явной паузы (`act(() => setTimeout(600))` в CheckInScreen и т. п.).
  От `asyncUtilTimeout` они не зависят. Тавтологий не появилось.
- **Фейковые таймеры (вопрос 2).** Все 7 вызовов `vi.useFakeTimers` в админке (DisputeSeries, RaceEditor.corridor ×2,
  RouteScreen, RoutesScreen, SignInScreen) идут с `shouldAdvanceTime: true`. В Vitest нет глобального `jest`, поэтому
  DTL `waitFor` идёт по ветке настоящих таймеров, но берёт глобальные `setTimeout`/`setInterval`, а их подменяют
  фейковые. При `shouldAdvanceTime` фейковые часы идут вместе с настоящими, и срок срабатывает. Проверено пробой
  (временный тест вне репозитория, `setupFiles` = `apps/admin/src/test/setup.ts`): `getConfig().asyncUtilTimeout === 15000`.
  Промахнувшийся `findByText` под `vi.useFakeTimers({ shouldAdvanceTime: true })` отклоняется с `Unable to find`
  примерно за 15 с, до `testTimeout`. Без `shouldAdvanceTime` срок не сработал бы никогда, но так было и при 1 с.
  Таких вызовов в админке нет.
- **node-окружение (вопрос 3).** Пять тестов без `@vitest-environment jsdom` (`csp`, `format`, `design-system`,
  `map-style`, `scanner`) зелёные. Импорт `@testing-library/react` в node безопасен: `screen` без `document`
  ломается только при обращении, `afterEach(cleanup)` без `globals` не регистрируется. `@testing-library/dom` в
  дереве один (10.4.2, hoisted), прямых импортов `@testing-library/dom` в тестах нет, так что `configure` действует
  на тот же экземпляр.
- **Прогон:** `npx vitest run` по 12 файлам (5 node + DisputeSeries, SignInScreen, RouteScreen, RoutesScreen,
  RaceEditor.corridor, CheckInScreen, MembersScreen): 117/117 зелёные. Других локальных `{ timeout }` и
  `}, N)` в `apps/admin/src` не осталось.
- **task.md (вопрос 4).** Сверено: `CONDITION_WAIT` 15 с в `apps/api/test/wait.ts:10`, `testTimeout`/`hookTimeout`
  60 с в `apps/api/vitest.config.mts:38-39`. Тест коридора «выбор готового маршрута…» (стр. 137) действительно
  без фейковых таймеров. Цифры §6 (нагрузка, прогоны) я не воспроизводил: NOT VERIFIED, принимаю как отчёт автора.
  §8 ссылается на `pr.md`, которого в diff нет: `pnpm check` для этого коммита NOT VERIFIED.

### [MEDIUM] `vi.waitFor` в админке остался со сроком 1 с — та же причина флака не закрыта
- **file:** apps/admin/src/features/overview/OverviewScreen.test.tsx; apps/admin/src/session/query-client.test.tsx
- **location:** OverviewScreen.test.tsx:95, 142, 158, 183, 192, 198; query-client.test.tsx:38
- **problem:** `configure({ asyncUtilTimeout })` меняет срок только у RTL `findBy*`/`waitFor`. У `vi.waitFor` из
  Vitest свой срок по умолчанию, 1000 мс, и он остался прежним. Комментарий в setup.ts и правило в pokatim-tests.md
  говорят «один срок на всё», хотя семь ожиданий в админке под него не попадают.
- **why_it_matters:** Это тот же класс сбоя, что в §4–5 task.md: условие на заглушках наступает всегда, но под
  нагрузкой (рост в 10–20 раз) не успевает за 1 с. OverviewScreen ждёт цепочку me → обзор → отрисовка плиток, то есть
  ровно тот сценарий, где падал `SeasonScreen`. Кроме того, `.claude/rules/pokatim-tests.md` (строка выше правки)
  прямо запрещает «`vi.waitFor` с умолчанием 1 с».
- **evidence:** `await vi.waitFor(() => expect(tile('Открытые споры').textContent).toContain('2'));` без опций.
  Срок по умолчанию `vi.waitFor` в vitest@5.0.5 — `timeout: 1000`. На `vi.waitFor` RTL `configure` не влияет.
- **recommended_fix:** в этих 7 местах заменить `vi.waitFor` на RTL `waitFor` из `@testing-library/react` (тогда
  действует общий срок 15 с) или явно передавать общий срок. В правиле уточнить: «срок RTL `findBy*`/`waitFor`»
  и «`vi.waitFor` в админке не использовать».

### [LOW] Правило не называет условие `shouldAdvanceTime` для фейковых таймеров админки
- **file:** .claude/rules/pokatim-tests.md
- **location:** добавленная фраза «Админка: срок `findBy*`/`waitFor` — общий 15 с …»
- **problem:** RTL `waitFor` в Vitest срабатывает по сроку только при `vi.useFakeTimers({ shouldAdvanceTime: true })`.
  Без этого флага промах висит до `testTimeout`, а он теперь 60 с, а не 5. Сейчас все вызовы в админке с флагом,
  но правило об этом не говорит.
- **why_it_matters:** Если в будущем тест вызовет `vi.useFakeTimers()` без флага, упавший `findBy` будет висеть
  минуту и закончится общим «Test timed out» вместо сообщения RTL с DOM. Тогда пропадает довод task.md §7 о том, что
  `testTimeout` выше срока RTL.
- **evidence:** проба: при `shouldAdvanceTime: true` отказ приходит примерно через 15 с. Ветка DTL без `jest` ставит
  срок через глобальный `setTimeout`, а его подменяют фейковые таймеры.
- **recommended_fix:** добавить в правило: «фейковые таймеры в тестах панели — только с `shouldAdvanceTime: true`».
