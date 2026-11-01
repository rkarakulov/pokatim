# Findings — small-followups-api — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..HEAD
verdict: REQUEST CHANGES

### [HIGH] Отрицательный тест оставляет подменённый `admitEntry` для следующих тестов

- **file:** apps/api/src/modules/results/results-entries.int.test.ts
- **location:** 142–176, `racedEntries`
- **problem:** `mockImplementation` не восстанавливается после теста. Сценарий `readOnly: true` оставляет `RacesRepository.admitEntry` в режиме чтения для всех последующих тестов этого файла.
- **why_it_matters:** Последующие проверки выполняются без настоящего замка гонки и записи счётчика. Например, тест «вторая заявка во время отмены гонки» ожидает `entryAdmissions === 1`, но оставшаяся подмена вообще не записывает это поле. Полный прогон файла получает регрессии, которых не видно при изолированном запуске новых тестов.
- **evidence:** Строка 149 устанавливает постоянную подмену, строки 152–156 при `readOnly` только читают гонку. `beforeEach` вызывает лишь `h.reset()`: реализация стенда очищает коллекции, Redis, часы и почту, но не восстанавливает mocks. В `apps/api/vitest.config.mts` восстановление mocks не включено; локального `mockRestore` также нет. `RaceRegistry.admitEntry` обращается к тому же экземпляру репозитория.
- **recommended_fix:** Сохранить spy и гарантированно вызвать `mockRestore()` в `finally` либо через `onTestFinished`. При очистке также открывать ворота и дожидаться начатых запросов, чтобы ошибка ожидания не оставляла незавершённые операции. После исправления прогнать весь `results-entries.int.test.ts` и `pnpm check`.

Проверки: `git diff --check origin/develop...HEAD` и `format:check` прошли. **NOT VERIFIED:** полный `pnpm check` — завершённого результата нет, последняя полученная стадия — ESLint. Интеграционные сценарии и обход `NSURLCache` на iOS в этом проходе не запускались.